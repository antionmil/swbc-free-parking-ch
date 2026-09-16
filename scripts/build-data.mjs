/* Build one data file per city from official open data.
 *
 *   node scripts/build-data.mjs            # every city
 *   node scripts/build-data.mjs geneve     # one city
 *
 *   public/data/zurich.json   City of Zurich, DAV parking layers (CC0)
 *   public/data/geneve.json   Canton of Geneva, SITG OTC_STATIONNEMENT_V_PUBLIQUE
 *   public/data/bern.json     City of Bern, Geoportal Parkplaetze_oeffentlich (blue zone layer)
 *   public/data/luzern.json   City of Lucerne, OGD oeffentlicher_parkplatz
 *   public/data/lausanne.json City of Lausanne, map.lausanne.ch stationnement layers
 *
 * Bern, Lucerne and Lausanne publish no street names with their parking, so
 * those are taken from OpenStreetMap streets (Overpass, once a night, credited
 * on the page), the same nearest-street method Zurich uses with its own
 * street register.
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

async function fetchText(url, init = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { "user-agent": "freeparking.onedaybuilt.com data build", ...(init.headers ?? {}) } });
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === 3) throw new Error(`${url.slice(0, 120)} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 8000 * attempt));
    }
  }
}

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
  if (!Array.isArray(coords) || coords.length === 0) return out;
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


/* ---------- Shared for cities without street names ---------- */

/** swisstopo's approximate LV95 → WGS84 formulas, accurate to about a metre. */
export function lv95ToWgs84(e, n) {
  const y = (e - 2600000) / 1e6, x = (n - 1200000) / 1e6;
  const lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y;
  const lat = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x * x * x;
  return [(lon * 100) / 36, (lat * 100) / 36];
}

/** A WFS asked for EPSG:4326 may answer [lat, lon] (Bern) or [lon, lat]
 *  (Lucerne). In Switzerland the two ranges never overlap — latitude 45.8–47.9,
 *  longitude 5.9–10.5 — so the numbers say which is which. */
export const lonLat = ([a, b]) => (a > 20 ? [b, a] : [a, b]);

/** Middle of a feature: the average of its vertices, as [lon, lat]. */
function middleOf(coords, convert = lonLat) {
  const pts = flatten(coords).filter((p) => p.length >= 2 && p.every(Number.isFinite)).map(convert);
  // One Bern stretch has an empty shape: an average of nothing is NaN, and a
  // NaN spot would sit in the file, unreachable and unexplained.
  if (pts.length === 0) return null;
  return [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];
}

/** Named OpenStreetMap streets in a box, fetched once per box.
 *  Cars do not park on footpaths: a "Passage" or a square's footway 15 m away
 *  must not name a stretch that lies on the road beside it. */
const osmCache = new Map();
const NOT_FOR_CARS = /^(footway|path|pedestrian|steps|cycleway|bridleway|corridor|platform|track|elevator|via_ferrata|proposed|construction)$/;

async function osmWays(box) {
  const key = JSON.stringify(box);
  if (osmCache.has(key)) return osmCache.get(key);
  const query = `[out:json][timeout:180];way["highway"]["name"](${box.s},${box.w},${box.n},${box.e});out geom;`;
  const text = await fetchText("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  const ways = JSON.parse(text).elements.filter((e) => e.type === "way" && e.geometry && e.tags?.name && !NOT_FOR_CARS.test(e.tags.highway ?? ""));
  if (ways.length < 500) throw new Error(`only ${ways.length} named streets from OpenStreetMap — refusing to use that`);
  osmCache.set(key, ways);
  return ways;
}

/** The nearest named street to a point, within 45 m. */
async function osmStreetNamer(box, lat0) {
  const ways = await osmWays(box);
  const toXY = xyAt(lat0);
  const items = ways.map((w) => {
    const line = w.geometry.map((g) => toXY([g.lon, g.lat]));
    return { name: w.tags.name, pts: line, lines: [line] };
  });
  const near = grid(items);
  return (lonlat) => {
    const [x, y] = toXY(lonlat);
    let best = null, bestD = 45;
    for (const s of near(x, y, 1)) for (const line of s.lines) for (let i = 1; i < line.length; i++) {
      const d = segDist([x, y], line[i - 1], line[i]);
      if (d < bestD) { bestD = d; best = s.name; }
    }
    return best;
  };
}

/** raw spots → the published file shape shared by every city after Zurich. */
function cityFile({ city, source, raw, lat0, schedules = [] }) {
  const spots = mergeSpots(raw, (r) => `${r.kind}|${r.street ?? "?"}|${r.maxMin ?? ""}|${r.schedule ? JSON.stringify(r.schedule) : ""}`);
  const streetNames = [...new Set(spots.map((s) => s.street).filter(Boolean))].sort();
  const scheduleKeys = [...new Set(spots.filter((s) => s.schedule).map((s) => JSON.stringify(s.schedule)))];
  const { mx, my } = scaleAt(lat0);
  const code = { blue: 0, paid: 1, free: 2, limited: 3 };
  const out = {
    city,
    stand: new Date().toISOString().slice(0, 10),
    dated: "fetched",
    source,
    streets: streetNames,
    schedules: scheduleKeys.map((k) => JSON.parse(k)),
    spots: spots.map((s) => [
      +(s.y / my).toFixed(6),
      +(s.x / mx).toFixed(6),
      code[s.kind],
      s.spaces,
      s.street ? streetNames.indexOf(s.street) : -1,
      s.kind === "limited" ? s.maxMin : s.kind === "paid" ? scheduleKeys.indexOf(JSON.stringify(s.schedule)) : -1,
    ]),
  };
  const sum = (kind) => spots.filter((s) => s.kind === kind).reduce((a, s) => a + s.spaces, 0);
  const summary = [
    `blue zone: ${sum("blue")} places · free, no limit: ${sum("free")} · free with a limit: ${sum("limited")} · paid, free outside hours: ${sum("paid")}`,
    `spots: ${spots.length}; unnamed: ${spots.filter((s) => !s.street).length}`,
  ];
  return { out, summary };
}

/* ---------- Bern ----------
 * Geoportal Parkplaetze_oeffentlich. Only the blue zone layer is used
 * ("P blau (APK)": the blue zone, where residents also have permit cards).
 * White APK spaces, short-term white spaces and paid spaces carry no duration
 * or hours in the data, so they are not offered. Positions are marked
 * "ungenau" (approximate) for most stretches by the city itself. */
const BERN_WFS = "https://map.bern.ch/arcgis/services/Geoportal/Parkplaetze_oeffentlich/MapServer/WFSServer";
const BERN_BOX = { s: 46.91, w: 7.35, n: 46.99, e: 7.5 };

async function buildBern() {
  const features = await get(`${BERN_WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=Geoportal_Parkplaetze_oeffentlich_2:Parkfeld_blau_APK&outputFormat=GEOJSON&srsName=urn:ogc:def:crs:EPSG::4326`);
  const nameAt = await osmStreetNamer(BERN_BOX, 46.95);
  const toXY = xyAt(46.95);
  const raw = [];
  for (const f of features) {
    const pr = f.properties;
    if (!f.geometry || pr.Status_beschrieb !== "Definitiv") continue;
    const ll = middleOf(f.geometry.coordinates);
    if (!ll) continue;
    const [x, y] = toXY(ll);
    raw.push({ kind: "blue", x, y, spaces: Math.max(1, pr.ANZAHL_PARKFELDER ?? 1), street: nameAt(ll) });
  }
  const file = cityFile({ city: "Bern", source: "City of Bern, Geoportal Parkplätze (öffentlich); street names © OpenStreetMap contributors", raw, lat0: 46.95 });
  file.summary.unshift(`${features.length} blue zone stretches from the city`);
  return file;
}

/* ---------- Lucerne ----------
 * OGD oeffentlicher_parkplatz. Each car space has a type and an operating
 * concept in words. Used:
 *   blue zone            PP_TYP 2 with "Mo-Sa, 08:00-19:00, 60min"
 *   free, no limit       "kein Regime, keine max. Zeit" and no fee
 *   free with a disc     PP_TYP 0 (white, disc), no fee, ZEIT minutes
 *   paid by day only     fee text "… 07.00-19.00, tägl." — free 19:00–07:00
 * Anything with a remark (BEMERKUNG) is dropped: remarks are where the
 * exceptions live ("Parkverbot Mo–Fr 06–18 ausgenommen …", "reserviert"). */
const LUZERN_WFS = "https://map.stadtluzern.ch/server/services/OGD/oeffentlicher_parkplatz/MapServer/WFSServer";
const LUZERN_BOX = { s: 47.0, w: 8.22, n: 47.09, e: 8.38 };

export function luzernKind(pr) {
  if (pr.SUBTYPE_TEXT !== "Auto-Parkplatz") return null;
  if (pr.BEMERKUNG && String(pr.BEMERKUNG).trim() && String(pr.BEMERKUNG).trim() !== "null") return null;
  const noFee = pr.GEBUEHR_TEXT == null || pr.GEBUEHR_TEXT === "Keine";
  const concept = (pr.BETRIEBSKONZEPT_TEXT ?? "").trim();
  if (pr.PP_TYP === 2 && /^Mo-Sa, 08[:.]00-19[:.]00, 60min$/.test(concept)) return { kind: "blue" };
  if (concept === "kein Regime, keine max. Zeit" && noFee && (pr.PP_TYP === 0 || pr.PP_TYP == null)) return { kind: "free" };
  if (pr.PP_TYP === 0 && noFee && Number(pr.ZEIT) >= 15 && Number(pr.ZEIT) < 4320) return { kind: "limited", maxMin: Number(pr.ZEIT) };
  if (pr.PP_TYP === 1 && /07\.00-19\.00, tägl\.$/.test(pr.GEBUEHR_TEXT ?? "") && /^Tägl\. 07 - 19/.test(concept)) {
    return { kind: "paid", schedule: { days: "Mo-So", from: 420, to: 1140, maxMin: Number(pr.ZEIT) || 0 } };
  }
  return null;
}

async function buildLuzern() {
  const features = await get(`${LUZERN_WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${encodeURIComponent("esri:Öffentlicher_Parkplatz")}&outputFormat=GEOJSON&srsName=urn:ogc:def:crs:EPSG::4326`);
  const nameAt = await osmStreetNamer(LUZERN_BOX, 47.05);
  const toXY = xyAt(47.05);
  const raw = [];
  for (const f of features) {
    const k = luzernKind(f.properties);
    if (!k || !f.geometry) continue;
    const ll = middleOf(f.geometry.coordinates);
    if (!ll) continue;
    const [x, y] = toXY(ll);
    raw.push({ ...k, x, y, spaces: Math.max(1, f.properties.PP_ZAHL ?? 1), street: nameAt(ll) });
  }
  const file = cityFile({ city: "Lucerne", source: "City of Lucerne, OGD öffentliche Parkplätze; street names © OpenStreetMap contributors", raw, lat0: 47.05 });
  file.summary.unshift(`${features.length} spaces and stretches from the city, ${raw.length} used`);
  return file;
}

/* ---------- Lausanne ----------
 * map.lausanne.ch WFS (GML only). Used:
 *   "Zones bleues (macaron)"   blue zone for visitors — the national disc rules
 *   "Zones blanches"           duree_max "Illimité" → free, no limit;
 *                              "3h", "10h", … → free with a disc for that long
 * Paid zones have a maximum stay but no paid hours in the data: dropped.
 * Source to be named: Ville de Lausanne. */
const LAUSANNE_WFS = "https://map.lausanne.ch/mapserv_proxy?ogcserver=source+for+image%2Fpng&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&SRSNAME=EPSG:2056&TYPENAME=";
const LAUSANNE_BOX = { s: 46.49, w: 6.56, n: 46.61, e: 6.73 };

export function lausanneKind(type, duree) {
  const t = (type ?? "").trim(), d = (duree ?? "").trim();
  if (t === "Zones bleues (macaron)") return { kind: "blue" };
  if (t === "Zones blanches") {
    if (d === "Illimité") return { kind: "free" };
    const m = /^(\d+)\s*(h|min)$/.exec(d);
    if (m) return { kind: "limited", maxMin: +m[1] * (m[2] === "h" ? 60 : 1) };
  }
  return null;
}

/** The few GML shapes MapServer returns: members, their ms:* fields, and every coordinate pair. */
export function parseGml(xml) {
  return [...xml.matchAll(/<gml:featureMember>([\s\S]*?)<\/gml:featureMember>/g)].map(([, m]) => {
    const props = Object.fromEntries([...m.matchAll(/<ms:([A-Za-z_0-9]+)>([^<]*)<\/ms:\1>/g)].map(([, k, v]) => [k, v]));
    // The shape sits in <ms:geom> on map.lausanne.ch (<ms:msGeometry> on other
    // MapServers): read every posList in the member. The bounding box uses
    // lowerCorner/upperCorner, so it is not picked up.
    const nums = [...m.matchAll(/<gml:(?:posList|pos|coordinates)[^>]*>([^<]+)</g)].flatMap(([, t]) => t.trim().split(/[\s,]+/).map(Number));
    const pairs = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pairs.push([nums[i], nums[i + 1]]);
    return { props, pairs };
  });
}

async function buildLausanne() {
  const layers = ["mobilite_stationnement_zbleuesmac", "mobilite_stationnement_zblanches"];
  const members = [];
  for (const l of layers) {
    const xml = await fetchText(LAUSANNE_WFS + l);
    const got = parseGml(xml);
    if (l.endsWith("zbleuesmac") && got.length < 200) throw new Error(`only ${got.length} blue zone stretches from Lausanne`);
    members.push(...got);
  }
  const nameAt = await osmStreetNamer(LAUSANNE_BOX, 46.52);
  const toXY = xyAt(46.52);
  const raw = [];
  for (const { props, pairs } of members) {
    const k = lausanneKind(props.type_txt, props.duree_max);
    if (!k || pairs.length === 0) continue;
    const pts = pairs.filter(([e, n]) => e > 2400000 && e < 2900000 && n > 1000000 && n < 1300000).map(([e, n]) => lv95ToWgs84(e, n));
    if (pts.length === 0) continue;
    const ll = [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];
    const [x, y] = toXY(ll);
    raw.push({ ...k, x, y, spaces: Math.max(1, Number(props.nb_places) || 1), street: nameAt(ll) });
  }
  const file = cityFile({ city: "Lausanne", source: "Ville de Lausanne, stationnement (map.lausanne.ch); street names © OpenStreetMap contributors", raw, lat0: 46.52 });
  file.summary.unshift(`${members.length} stretches from the city, ${raw.length} used`);
  return file;
}


/* ---------- Basel ----------
 *
 * STREET LEVEL, and the page says so. Basel-Stadt publishes `Parkflächen`
 * openly — every stretch with its street, type, fee hours, maximum stay and
 * number of spaces — but WITHOUT positions: 0 of 7,815 rows carry geometry.
 * The layer that does have positions ("Parkieren: Parkflächen") is category B,
 * "beschränkt öffentlich", behind a special login applied for by form.
 *
 * So each row is placed along ITS OWN STREET, taken from OpenStreetMap: the
 * street is cut into roughly 80 m pieces and its spaces are shared out along
 * it. A Basel result therefore means "somewhere along this street", never "at
 * this spot" — the page says that, and the copy button gives the street, not
 * a point that would look exact.
 *
 * 96% of car rows match a street by name; the rest differ only in spacing
 * ("St.Johanns-Ring" against "St. Johanns-Ring"), which normalising fixes. */
const BASEL_TABLE = "https://data.bs.ch/api/explore/v2.1/catalog/datasets/100329/exports/json";
const BASEL_BOX = { s: 47.51, w: 7.53, n: 47.61, e: 7.68 };
const normStreet = (n) => (n ?? "").toLowerCase().replace(/[\s.]/g, "");

/** "MO-SA: 08:00-19:00" → paid Monday to Saturday, 08:00–19:00. Around the
 *  clock ("MO-SO: 00:00-24:00") is never free, so it is dropped, and so is
 *  any shape this does not cover. */
export function baselSchedule(text) {
  const m = /^MO-(SA|SO):\s*(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec((text ?? "").trim());
  if (!m) return null;
  const from = +m[2] * 60 + +m[3], to = +m[4] * 60 + +m[5];
  if (from === 0 && to === 1440) return null;
  return { days: m[1] === "SA" ? "Mo-Sa" : "Mo-So", from, to, maxMin: 0 };
}

export function baselKind(row) {
  if (row.typ === "Blaue Zone") return { kind: "blue" };
  if (row.typ === "Parkplätze unbewirtschaftet") return { kind: "free" };
  if (row.typ === "Parkplätze gebührenpflichtig") {
    const schedule = baselSchedule(row.gebpflicht);
    return schedule ? { kind: "paid", schedule } : null;
  }
  return null; // time-limited fields without a duration, no-parking fields, bikes, taxis …
}

async function buildBasel() {
  const rows = JSON.parse(await fetchText(BASEL_TABLE));
  if (!Array.isArray(rows) || rows.length < 1000) throw new Error(`Basel table returned ${rows?.length} rows`);
  const ways = await osmWays(BASEL_BOX);
  const toXY = xyAt(47.56);

  // Street name → its pieces with their lengths, so a street's spaces spread
  // along it instead of piling onto one point.
  const pieces = new Map();
  for (const w of ways) {
    const key = normStreet(w.tags.name);
    const list = pieces.get(key) ?? [];
    let run = [];
    let runLen = 0;
    const flush = () => {
      if (run.length < 2) return;
      const mid = run[Math.floor(run.length / 2)];
      list.push({ name: w.tags.name, lon: mid.lon, lat: mid.lat, len: runLen });
      run = [run[run.length - 1]];
      runLen = 0;
    };
    for (const g of w.geometry) {
      if (run.length) {
        const prev = run[run.length - 1];
        runLen += Math.hypot((g.lon - prev.lon) * 76000, (g.lat - prev.lat) * 111000);
      }
      run.push(g);
      if (runLen >= 80) flush();
    }
    flush();
    if (list.length) pieces.set(key, list);
  }

  const raw = [];
  let unmatched = 0, unmatchedSpaces = 0;
  for (const row of rows) {
    const k = baselKind(row);
    if (!k) continue;
    const spaces = row.anzahl_parkfelder ?? 0;
    if (spaces <= 0) continue;
    const list = pieces.get(normStreet(row.strasse));
    if (!list) { unmatched++; unmatchedSpaces += spaces; continue; }
    /* Share the street's spaces along its pieces, keeping the total exact:
       rounding each piece on its own dropped a fifth of Basel's spaces. */
    const total = list.reduce((a, p) => a + p.len, 0) || list.length;
    let carried = 0, given = 0;
    list.forEach((piece, i) => {
      carried += (spaces * (piece.len || 1)) / total;
      const take = i === list.length - 1 ? spaces - given : Math.round(carried - given);
      given += take;
      if (take <= 0) return;
      const [x, y] = toXY([piece.lon, piece.lat]);
      raw.push({ ...k, x, y, spaces: take, street: piece.name });
    });
  }

  const file = cityFile({
    city: "Basel",
    source: "Canton of Basel-Stadt, Parkflächen (CC BY); placed along the street with OpenStreetMap contributors",
    raw, lat0: 47.56,
  });
  file.out.approx = true; // the page says "along this street", not "at this spot"
  file.summary.unshift(`${rows.length} rows from the canton; ${unmatched} rows (${unmatchedSpaces} spaces) had no matching street and were dropped`);
  return file;
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
export function publish(file, out) {
  const path = `public/data/${file}`;
  // A first file has nothing to compare with, so an empty one would pass the
  // drop check below. Day 13: Lausanne's first build read 1,210 stretches,
  // used 0, and wrote a valid, empty file.
  if (out.spots.length < 50) throw new Error(`${file}: only ${out.spots.length} spots — refusing to publish`);
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

const CITIES = {
  zurich: { file: "zurich.json", build: buildZurich },
  geneve: { file: "geneve.json", build: buildGeneve },
  bern: { file: "bern.json", build: buildBern },
  luzern: { file: "luzern.json", build: buildLuzern },
  lausanne: { file: "lausanne.json", build: buildLausanne },
  basel: { file: "basel.json", build: buildBasel },
};

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
