/* Build one data file per city from official open data.
 *
 *   node scripts/build-data.mjs            # every city
 *   node scripts/build-data.mjs geneve     # one city
 *
 *   public/data/zurich.json   City of Zurich, DAV parking layers (CC0)
 *   public/data/geneve.json   Canton of Geneva, SITG OTC_STATIONNEMENT_V_PUBLIQUE
 *
 * A city that fails does not stop the others; the job still exits 1 so the
 * failure is seen. Each file keeps its own "refuse a sudden drop" guard.
 *
 * Runs every night in GitHub Actions (.github/workflows/data.yml) and commits
 * the file when it changes, which redeploys the site. Nothing is fetched from
 * the city while a visitor is on the page.
 *
 * Sources, all CC0, Stadt Zürich Dienstabteilung Verkehr:
 *   oeff_strassenparkierung_dav_p   every public parking space as a point
 *   oeff_strassenparkierung_dav_l   parallel parking stretches as lines, with length
 *   oeff_strassenparkierung_spuzpu  parking meters, with tariff hours
 *   sv_str_lin                      street names (Strassennamenverzeichnis)
 *
 * What is kept, and why:
 *   - Blue zone points and lines: free with a disc, national rules.
 *   - Paid spaces (art Standard, gebpflicht 1) whose nearby meters ALL share one
 *     readable schedule: free outside those hours. A space near two different
 *     schedules, or near a special tariff ("Zoo ganze Woche", "Kreis 5 Spezial"),
 *     is dropped — never guessed.
 *   - White disc spaces (art Parkscheibe) are dropped: the data gives no
 *     maximum duration for them, so there is no instruction to give.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const WFS = "https://www.ogd.stadt-zuerich.ch/wfs/geoportal";
const layer = (service, name) =>
  `${WFS}/${service}?SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&TYPENAME=${name}&OUTPUTFORMAT=GeoJSON&SRSNAME=EPSG:4326`;

async function get(url, { allowEmpty = false } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "freeparking.onedaybuilt.com data build" } });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.features) || (!allowEmpty && json.features.length === 0)) throw new Error("no features");
      return json.features;
    } catch (err) {
      if (attempt === 3) throw new Error(`${url} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

/* Equirectangular metres around Zurich: accurate to well under 1% at this
   scale, and ten times simpler than haversine in a hot loop. */
const scaleAt = (lat0) => ({ mx: 111320 * Math.cos((lat0 * Math.PI) / 180), my: 110574 });
const xyAt = (lat0) => { const { mx, my } = scaleAt(lat0); return ([lon, lat]) => [lon * mx, lat * my]; };
const { mx: MX, my: MY } = scaleAt(47.37);
const xy = xyAt(47.37);

function flatten(coords, out = []) {
  if (typeof coords[0] === "number") out.push(coords);
  else for (const c of coords) flatten(c, out);
  return out;
}

function segDist(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/* A 100 m grid, so "nearest street" and "meters within 120 m" are local. */
function grid(items, cell = 100) {
  const g = new Map();
  for (const it of items) {
    for (const [x, y] of it.pts) {
      const k = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
      if (!g.has(k)) g.set(k, new Set());
      g.get(k).add(it);
    }
  }
  return (x, y, r = 1) => {
    const found = new Set();
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (const it of g.get(`${cx + i}:${cy + j}`) ?? []) found.add(it);
    return found;
  };
}

/* "HOCH 2h Mo-Sa 09:00-20:00" → { days: [1..6], from: 540, to: 1200, maxMin: 120 }.
   Anything that does not match this exact shape returns null and is not used. */
export function parseTariff(text) {
  const m = /^(?:HOCH|NIEDER)\s+([\d.]+)h\s+Mo-(Sa|So)\s+(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec((text ?? "").trim());
  if (!m) return null;
  const from = +m[3] * 60 + +m[4];
  const to = +m[5] * 60 + +m[6];
  return { days: m[2] === "Sa" ? "Mo-Sa" : "Mo-So", from, to, maxMin: Math.round(+m[1] * 60), always: m[2] === "So" && from === 0 && to === 1440 };
}

async function buildZurich() {
  const [points, lines, meters, streets] = await Promise.all([
    get(layer("oeffentlich_zugaengliche_Parkplaetze_DAV", "oeff_strassenparkierung_dav_p")),
    get(layer("oeffentlich_zugaengliche_Parkplaetze_DAV", "oeff_strassenparkierung_dav_l")),
    get(layer("oeffentlich_zugaengliche_Parkplaetze_DAV", "oeff_strassenparkierung_spuzpu")),
    get(layer("Strassennamenverzeichnis", "sv_str_lin")),
  ]);

  const stand = points.map((f) => f.properties.stand).filter(Boolean).sort().at(-1);
  if (!stand) throw new Error("no 'stand' date in the parking data — refusing to publish an undated file");

  // Streets as segments.
  const streetItems = streets
    .filter((f) => f.geometry && f.properties.str_name)
    .map((f) => ({ name: f.properties.str_name, pts: flatten(f.geometry.coordinates).map(xy), lines: f.geometry.coordinates.map((l) => l.map(xy)) }));
  const nearStreets = grid(streetItems);
  const streetOf = ([x, y]) => {
    let best = null, bestD = 45;
    for (const s of nearStreets(x, y, 1)) for (const line of s.lines) for (let i = 1; i < line.length; i++) {
      const d = segDist([x, y], line[i - 1], line[i]);
      if (d < bestD) { bestD = d; best = s.name; }
    }
    return best;
  };

  // Meters with a readable schedule. Unreadable ones still count, as "unknown".
  const meterItems = meters.map((f) => {
    const p = f.geometry.type === "Point" ? f.geometry.coordinates : flatten(f.geometry.coordinates)[0];
    return { tariff: f.properties.tarif, parsed: parseTariff(f.properties.tarif), pts: [xy(p)] };
  });
  const nearMeters = grid(meterItems);
  const scheduleFor = ([x, y]) => {
    const found = [...nearMeters(x, y, 2)].filter((m) => Math.hypot(m.pts[0][0] - x, m.pts[0][1] - y) <= 120);
    if (found.length === 0) return null;
    if (found.some((m) => !m.parsed)) return null;
    const keys = new Set(found.map((m) => `${m.parsed.days} ${m.parsed.from}-${m.parsed.to}`));
    if (keys.size !== 1) return null;
    const p = found[0].parsed;
    if (p.always) return null; // paid around the clock: never free, so not listed
    return { days: p.days, from: p.from, to: p.to, maxMin: Math.min(...found.map((m) => m.parsed.maxMin)) };
  };

  // Raw spaces: { kind: "blue" | "paid", x, y, spaces, schedule? }
  const raw = [];
  let droppedPaid = 0;
  for (const f of points) {
    const pr = f.properties;
    if (pr.zugang !== "öffentlich" || !f.geometry) continue;
    const p = xy(flatten(f.geometry.coordinates)[0]);
    if (pr.art === "Blaue Zone") raw.push({ kind: "blue", x: p[0], y: p[1], spaces: 1 });
    else if (pr.art === "Standard" && pr.gebpflicht === "1") {
      const schedule = scheduleFor(p);
      if (schedule) raw.push({ kind: "paid", x: p[0], y: p[1], spaces: 1, schedule });
      else droppedPaid++;
    }
  }
  for (const f of lines) {
    const pr = f.properties;
    if (pr.typ !== "Blaue Zone" || !f.geometry) continue;
    const pts = flatten(f.geometry.coordinates).map(xy);
    const mid = pts[Math.floor(pts.length / 2)];
    // A parallel space is about 5.5 m. Never fewer than one.
    raw.push({ kind: "blue", x: mid[0], y: mid[1], spaces: Math.max(1, Math.floor((pr.laenge ?? 0) / 5.5)) });
  }

  // Name each space, then merge spaces of the same kind on the same street
  // within 60 m into one "spot" — that is what a driver looks for.
  for (const r of raw) r.street = streetOf([r.x, r.y]);
  const spots = [];
  const cell = new Map();
  const key = (r) => `${r.kind}|${r.street ?? "?"}|${r.schedule ? `${r.schedule.days}${r.schedule.from}${r.schedule.to}${r.schedule.maxMin}` : ""}`;
  for (const r of raw) {
    const k = key(r);
    const list = cell.get(k) ?? [];
    let hit = list.find((s) => Math.hypot(s.x - r.x, s.y - r.y) <= 60);
    if (!hit) {
      hit = { kind: r.kind, street: r.street, schedule: r.schedule, x: r.x, y: r.y, spaces: 0, n: 0 };
      list.push(hit);
      spots.push(hit);
      cell.set(k, list);
    }
    hit.x = (hit.x * hit.n + r.x) / (hit.n + 1);
    hit.y = (hit.y * hit.n + r.y) / (hit.n + 1);
    hit.n += 1;
    hit.spaces += r.spaces;
  }

  const streetNames = [...new Set(spots.map((s) => s.street).filter(Boolean))].sort();
  const schedules = [...new Set(spots.filter((s) => s.schedule).map((s) => JSON.stringify(s.schedule)))];
  const out = {
    city: "Zurich",
    stand,
    // No build timestamp: it would make every nightly run a "change" and
    // redeploy the site even when the city's data is the same.
    source: "Stadt Zürich, Dienstabteilung Verkehr — öffentlich zugängliche Parkplätze DAV (CC0)",
    streets: streetNames,
    schedules: schedules.map((s) => JSON.parse(s)),
    // [lat, lon, kind (0 blue, 1 paid), spaces, street index or -1, schedule index or -1]
    spots: spots.map((s) => [
      +(s.y / MY).toFixed(6),
      +(s.x / MX).toFixed(6),
      s.kind === "blue" ? 0 : 1,
      s.spaces,
      s.street ? streetNames.indexOf(s.street) : -1,
      s.schedule ? schedules.indexOf(JSON.stringify(s.schedule)) : -1,
    ]),
  };

  const blue = spots.filter((s) => s.kind === "blue");
  const paid = spots.filter((s) => s.kind === "paid");
  return {
    out,
    summary: [
      `stand ${stand}`,
      `blue zone: ${blue.length} spots, ${blue.reduce((a, s) => a + s.spaces, 0)} spaces`,
      `paid, free outside meter hours: ${paid.length} spots, ${paid.reduce((a, s) => a + s.spaces, 0)} spaces; dropped (no single readable schedule): ${droppedPaid}`,
      `unnamed spots: ${spots.filter((s) => !s.street).length}`,
      `schedules: ${out.schedules.map((s) => `${s.days} ${s.from / 60}-${s.to / 60} max ${s.maxMin}`).join(" | ")}`,
    ],
  };
}

/* ---------- Geneva ----------
 *
 * SITG layer OTC_STATIONNEMENT_V_PUBLIQUE: every street parking stretch in the
 * canton as a line, with its street name, number of places and a type such as
 * "Gratuit 60 min" or "Payant 90 min". Free to reuse with the source named;
 * commercial use needs permission (this site is free). Types, and what the
 * site does with them:
 *   Gratuit 60 min            blue zone — the national disc rules; Geneva's
 *                             Fondation des Parkings states the same hours
 *   Gratuit illimité          free with no time limit
 *   Gratuit 30/120/180/240 min, 8/15 heures
 *                             free with a disc for that long. The hours the
 *                             limit applies are not in the data, so it is
 *                             treated as applying at all times: the answer
 *                             can only be stricter than the sign.
 *   Payant …                  dropped: the data has no paid hours
 *   Gratuit jaune, Habitant, Police, Cars, 2 roues, Vélos, …  dropped */
const SITG = "https://vector.sitg.ge.ch/arcgis/rest/services/OTC_STATIONNEMENT_V_PUBLIQUE/FeatureServer/0/query";
const SITG_STREETS = "https://vector.sitg.ge.ch/arcgis/rest/services/GMO_GRAPHE_VOIES_OFFICIELLES/FeatureServer/0/query";

/* NOM_RUES cannot be trusted on its own. Checked on day 13: 4,333 of 12,731
   stretches — a third — are named "Route de Foliaz", a road in Collonge-
   Bellerive, while lying all over the canton; the page told someone at Rue du
   Rhône to "Park on Route de Foliaz". So every name is checked against the
   canton's official street graph: a placeholder or empty name is replaced by
   the nearest official street within 45 m, and any other name whose street is
   more than 300 m away is treated as wrong and replaced the same way. */
const PLACEHOLDER_STREETS = new Set(["route de foliaz"]);

/** Geneva's official names put surnames in capitals — "Quai WILSON", "Rue du
 *  Colonel-COUTAU". Correct, but it reads as shouting, and Google Maps writes
 *  "Quai Wilson". Words of two or more capitals get a lower-case tail; initials
 *  ("A.-M.") are left alone. */
export const readableName = (name) => name.replace(/\p{Lu}{2,}/gu, (w) => w[0] + w.slice(1).toLowerCase());

export function genevaKind(type) {
  const t = (type ?? "").trim();
  if (t === "Gratuit 60 min") return { kind: "blue" };
  if (t === "Gratuit illimité") return { kind: "free" };
  const m = /^Gratuit (\d+) (min|heures)$/.exec(t);
  if (m) return { kind: "limited", maxMin: +m[1] * (m[2] === "heures" ? 60 : 1) };
  return null;
}

async function buildGeneve() {
  const features = [];
  for (let offset = 0; ; offset += 2000) {
    const url = `${SITG}?where=1%3D1&outFields=NOM_RUES,TYPE_STATIONNEMENT,NOMBRE_PLACES&returnGeometry=true&outSR=4326&resultOffset=${offset}&resultRecordCount=2000&orderByFields=OBJECTID&f=geojson`;
    const page = await get(url, { allowEmpty: offset > 0 });
    features.push(...page);
    if (page.length < 2000) break;
    if (offset > 100000) throw new Error("SITG paging did not end");
  }

  const streetFeatures = await get(`${SITG_STREETS}?where=STATUT%3D%27Existant%27&outFields=VOIE&returnGeometry=true&outSR=4326&resultRecordCount=4000&f=geojson`);
  if (streetFeatures.length >= 4000) throw new Error("street graph hit the 4,000 page size — add paging");
  const toXY = xyAt(46.2);
  const streetItems = streetFeatures
    .filter((f) => f.geometry && f.properties.VOIE)
    .map((f) => {
      const lines = f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [f.geometry.coordinates];
      return { name: f.properties.VOIE.trim(), pts: flatten(lines).map(toXY), lines: lines.map((l) => l.map(toXY)) };
    });
  const nearStreets = grid(streetItems);
  const byName = new Map();
  for (const it of streetItems) {
    const k = it.name.toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(it);
  }
  const distTo = (items, [x, y]) => {
    let best = Infinity;
    for (const s of items) for (const line of s.lines) for (let i = 1; i < line.length; i++) best = Math.min(best, segDist([x, y], line[i - 1], line[i]));
    return best;
  };
  const nearestStreet = ([x, y]) => {
    let best = null, bestD = 45;
    for (const s of nearStreets(x, y, 1)) {
      const d = distTo([s], [x, y]);
      if (d < bestD) { bestD = d; best = s.name; }
    }
    return best;
  };
  let renamed = 0, placeholders = 0;
  const nameFor = (given, p) => {
    const g = given?.trim();
    if (!g || PLACEHOLDER_STREETS.has(g.toLowerCase())) { placeholders++; return nearestStreet(p); }
    const official = byName.get(g.toLowerCase());
    if (official && distTo(official, p) > 300) { renamed++; return nearestStreet(p); }
    return official ? official[0].name : g;
  };

  const raw = [];
  const dropped = new Map();
  for (const f of features) {
    const pr = f.properties;
    const k = genevaKind(pr.TYPE_STATIONNEMENT);
    if (!k || !f.geometry) {
      dropped.set(pr.TYPE_STATIONNEMENT, (dropped.get(pr.TYPE_STATIONNEMENT) ?? 0) + (pr.NOMBRE_PLACES ?? 0));
      continue;
    }
    const pts = flatten(f.geometry.coordinates).map(toXY);
    const mid = pts[Math.floor(pts.length / 2)];
    const street = nameFor(pr.NOM_RUES, mid);
    raw.push({ kind: k.kind, maxMin: k.maxMin, x: mid[0], y: mid[1], spaces: Math.max(1, pr.NOMBRE_PLACES ?? 1), street: street && readableName(street) });
  }

  const spots = mergeSpots(raw, (r) => `${r.kind}|${r.street ?? "?"}|${r.maxMin ?? ""}`);
  const streetNames = [...new Set(spots.map((s) => s.street).filter(Boolean))].sort();
  const { mx, my } = scaleAt(46.2);
  const today = new Date().toISOString().slice(0, 10);
  const out = {
    city: "Geneva",
    // SITG rows carry no date. The file records the day it was fetched, and
    // the page says "fetched", not "from", so the date means what it says.
    stand: today,
    dated: "fetched",
    source: "Canton of Geneva, SITG — OTC_STATIONNEMENT_V_PUBLIQUE (source: SITG)",
    streets: streetNames,
    schedules: [],
    // [lat, lon, kind (0 blue, 2 free no limit, 3 free with limit), places, street index or -1, max minutes or -1]
    spots: spots.map((s) => [
      +(s.y / my).toFixed(6),
      +(s.x / mx).toFixed(6),
      s.kind === "blue" ? 0 : s.kind === "free" ? 2 : 3,
      s.spaces,
      s.street ? streetNames.indexOf(s.street) : -1,
      s.kind === "limited" ? s.maxMin : -1,
    ]),
  };
  const sum = (kind) => spots.filter((s) => s.kind === kind).reduce((a, s) => a + s.spaces, 0);
  return {
    out,
    summary: [
      `fetched ${today}, ${features.length} SITG stretches`,
      `blue zone: ${sum("blue")} places · free, no limit: ${sum("free")} · free with a limit: ${sum("limited")}`,
      `spots: ${spots.length}; unnamed: ${spots.filter((s) => !s.street).length}`,
      `street names: ${placeholders} placeholder or empty names replaced from the official street graph, ${renamed} names more than 300 m from their street replaced`,
      `dropped places by type: ${[...dropped].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", ")}`,
    ],
  };
}

/* ---------- Shared ---------- */

function mergeSpots(raw, keyOf) {
  const spots = [];
  const cell = new Map();
  for (const r of raw) {
    const k = keyOf(r);
    const list = cell.get(k) ?? [];
    let hit = list.find((s) => Math.hypot(s.x - r.x, s.y - r.y) <= 60);
    if (!hit) {
      hit = { kind: r.kind, street: r.street, schedule: r.schedule, maxMin: r.maxMin, x: r.x, y: r.y, spaces: 0, n: 0 };
      list.push(hit);
      spots.push(hit);
      cell.set(k, list);
    }
    hit.x = (hit.x * hit.n + r.x) / (hit.n + 1);
    hit.y = (hit.y * hit.n + r.y) / (hit.n + 1);
    hit.n += 1;
    hit.spaces += r.spaces;
  }
  return spots;
}

/* A bad night at a city's server must not become the published file. If the
   spot count falls by more than a third against the file already published,
   stop: the site keeps serving the old data, and the failed job is the alarm. */
function publish(file, out) {
  const path = `public/data/${file}`;
  if (existsSync(path)) {
    const before = JSON.parse(readFileSync(path, "utf8")).spots.length;
    if (out.spots.length < before * 0.67) {
      throw new Error(`${file}: spots fell from ${before} to ${out.spots.length} — refusing to overwrite the published file`);
    }
  }
  mkdirSync("public/data", { recursive: true });
  const json = JSON.stringify(out);
  writeFileSync(path, json);
  return `${path} ${(json.length / 1024).toFixed(0)} KB`;
}

const CITIES = { zurich: { file: "zurich.json", build: buildZurich }, geneve: { file: "geneve.json", build: buildGeneve } };

async function main() {
  const only = process.argv[2];
  const names = only ? [only] : Object.keys(CITIES);
  let failed = 0;
  for (const name of names) {
    const city = CITIES[name];
    if (!city) throw new Error(`unknown city ${name}`);
    try {
      const { out, summary } = await city.build();
      const written = publish(city.file, out);
      console.log(`== ${name}\n  ${[...summary, written].join("\n  ")}`);
    } catch (err) {
      failed++;
      console.error(`== ${name} FAILED: ${err.message}`);
    }
  }
  if (failed) process.exit(1);
}

// pathToFileURL, not a template string: the project path has spaces, which a
// file:// URL encodes, so a plain comparison was never true and the script
// exited 0 having done nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
