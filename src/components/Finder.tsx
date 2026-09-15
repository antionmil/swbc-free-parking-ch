"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { answer, laterToday, mapsLink, mapsText, nearby, type DataFile, type Moment, type Option, type Spot } from "@/lib/finder";
import { carsLabel, dayStart, dayWord, hhmm, isoDate, shortDay, wallFromDate, wallFromLocal, walkMinutes, type Wall } from "@/lib/rules";

const MapStrip = dynamic(() => import("./MapStrip"), { ssr: false, loading: () => <div className="h-40 w-full rounded-2xl bg-rule" /> });

/** `city` comes from the search when it knows it. It beats the rectangle
 *  below: Wallisellen's Glatt centre sits inside the rectangle but is another
 *  town, with no city of Zurich parking data. */
type Dest = { label: string; lat: number; lon: number; city?: string };

const isZurichCity = (d: Dest) => (d.city ? /^Zürich$/i.test(d.city) : inZurich(d.lat, d.lon));

/* The city of Zurich, generously: a destination outside it gets an honest
 * "not covered yet" instead of an empty answer. */
const ZURICH = { s: 47.32, n: 47.44, w: 8.44, e: 8.63 };
const inZurich = (lat: number, lon: number) => lat > ZURICH.s && lat < ZURICH.n && lon > ZURICH.w && lon < ZURICH.e;

const EXAMPLES: Dest[] = [
  { label: "Kunsthaus Zürich", lat: 47.37022, lon: 8.54798 },
  { label: "Letzigrund", lat: 47.3828, lon: 8.5039 },
  { label: "Zoo Zürich", lat: 47.38783, lon: 8.57727 },
  { label: "Hardbrücke", lat: 47.3852, lon: 8.51711 },
];

const STAYS = [
  { key: "60", label: "1 hour" },
  { key: "120", label: "2 hours" },
  { key: "180", label: "3 hours" },
  { key: "evening", label: "All evening" },
] as const;
type StayKey = (typeof STAYS)[number]["key"];

/** "All evening" means until midnight, at least an hour. */
const stayMinutes = (key: StayKey, arrival: Wall) => (key === "evening" ? Math.max(60, dayStart(arrival) + 1440 - arrival) : Number(key));

function when(w: Wall, from: Wall) {
  const word = dayWord(w, from);
  if (word === "today") return hhmm(w);
  if (word === "tomorrow") return `${hhmm(w)} tomorrow`;
  return `${word} ${hhmm(w)}`;
}

/* swisstopo labels look like "<i>Building</i> <b>Stadion Letzigrund</b> (ZH) - Zürich".
   The <i> part is a category in the browser's language ("Part of a ward",
   "tram", "haltestellen_"), which reads as noise in a destination field. */
function cleanLabel(html: string) {
  return html
    .replace(/<i>(?:<i>)?[^<]*(?:<\/i>)?<\/i>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s*\(ZH\)\s*-\s*Zürich$/, "")
    .replace(/\s*\([A-Z][a-z]{1,3}\)$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default function Finder() {
  const [data, setData] = useState<DataFile | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dest, setDest] = useState<Dest | null>(null);
  /* No clock during the static build. The page is prerendered once; a time
     baked in then ("Now · Tue 20:15") never matches the visitor's clock, and
     React threw a hydration error (#418) on every load of the live site. The
     clock starts in the browser. */
  const [nowWall, setNowWall] = useState<Wall | null>(null);
  const [picked, setPicked] = useState<Wall | null>(null); // null = now
  const [stay, setStay] = useState<StayKey>("60");
  const [editingTime, setEditingTime] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load the city file once. It is static and rebuilt every night.
  useEffect(() => {
    fetch("/data/zurich.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setLoadError(true));
  }, []);

  // "Now" keeps moving while the page is open.
  useEffect(() => {
    setNowWall(wallFromDate(new Date()));
    const t = setInterval(() => setNowWall(wallFromDate(new Date())), 30_000);
    return () => clearInterval(t);
  }, []);

  // Read a shared link once.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ll = q.get("ll")?.split(",").map(Number);
    if (ll && ll.length === 2 && ll.every(Number.isFinite)) setDest({ label: q.get("to") ?? "Shared place", lat: ll[0], lon: ll[1] });
    const at = q.get("at");
    if (at && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(at)) setPicked(wallFromLocal(at.slice(0, 10), at.slice(11)));
    const s = q.get("stay");
    if (s && STAYS.some((x) => x.key === s)) setStay(s as StayKey);
  }, []);

  // Keep the address bar shareable.
  useEffect(() => {
    if (!dest) return;
    const q = new URLSearchParams({ to: dest.label, ll: `${dest.lat.toFixed(5)},${dest.lon.toFixed(5)}`, stay });
    if (picked !== null) q.set("at", `${isoDate(picked)}T${hhmm(picked)}`);
    window.history.replaceState(null, "", `?${q}`);
  }, [dest, picked, stay]);

  const arrival = picked ?? nowWall ?? 0;
  const clockReady = picked !== null || nowWall !== null;
  const minutes = stayMinutes(stay, arrival);
  const covered = dest ? isZurichCity(dest) : true;
  const spots = useMemo(() => (data && dest && covered ? nearby(data, [dest.lat, dest.lon]) : []), [data, dest, covered]);
  const result = useMemo(() => answer(spots, arrival, minutes), [spots, arrival, minutes]);
  const moments = useMemo(() => laterToday(spots, arrival).filter((m) => m.at > arrival), [spots, arrival]);
  const best = result.fits[0] ?? null;

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard refused: the address bar still has the link */
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Search onPick={(d) => { setDest(d); setEditingTime(false); }} current={dest} />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setEditingTime((v) => !v)}
          className="rounded-full border border-ink bg-ink px-3 py-1.5 text-[13px] font-medium text-white"
          aria-expanded={editingTime}
        >
          {!clockReady ? "Now" : picked === null ? `Now · ${shortDay(arrival)} ${hhmm(arrival)}` : `${shortDay(arrival)} ${hhmm(arrival)}`}
        </button>
        {STAYS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setStay(s.key)}
            aria-pressed={stay === s.key}
            className={`rounded-full border px-3 py-1.5 text-[13px] ${stay === s.key ? "border-blue bg-blue-soft font-semibold text-blue" : "border-rule bg-card text-body"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {editingTime ? (
        <TimePicker
          value={arrival}
          isNow={picked === null}
          onChange={(w) => setPicked(w)}
          onNow={() => { setPicked(null); setEditingTime(false); }}
        />
      ) : null}

      {loadError ? (
        <p className="rounded-2xl bg-card p-4 text-[14px] text-red" role="alert">The parking data did not load. Refresh the page to try again.</p>
      ) : !dest ? (
        <Empty onPick={setDest} />
      ) : !covered ? (
        <div className="rounded-2xl bg-card p-5">
          <h2 className="text-[20px] font-bold">Only Zurich so far.</h2>
          <p className="mt-1 text-[14px] text-body">{dest.label} is outside the city of Zurich. Other Swiss cities come next, city by city, as their open data allows.</p>
        </div>
      ) : !data || !clockReady ? (
        <div className="h-48 animate-pulse rounded-2xl bg-card" aria-label="Loading parking data" />
      ) : best ? (
        <Instruction option={best} arrival={arrival} />
      ) : (
        <Nothing spots={spots.length} stayLabel={STAYS.find((s) => s.key === stay)!.label} arrival={arrival} shorter={result.shorter} />
      )}

      {dest && covered && data && clockReady ? (
        <>
          <MapStrip dest={[dest.lat, dest.lon]} chosen={best ?? result.shorter} others={result.fits.slice(1)} />

          {result.fits.length > 1 ? (
            <section>
              <p className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-[.14em] text-muted">If it&rsquo;s full · more free parking nearby</p>
              {result.fits.slice(1).map((o) => (
                <div key={`${o.spot.lat},${o.spot.lon}`} className="border-b border-rule py-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-[14px]">
                    <span className="font-medium">{o.spot.street ?? "Unnamed street"}</span>
                    <span className="text-right text-[12px] text-muted">
                      {Math.round(o.spot.dist / 10) * 10} m · {o.spot.kind === "blue" ? "blue zone" : "no fee now"} · {carsLabel(o.spot.spaces)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="text-[12px] text-muted">
                      {o.disc !== null ? `Disc ${hhmm(o.disc)} · ` : ""}until {when(o.until, arrival)}
                    </span>
                    <MapsButtons spot={o.spot} compact />
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {moments.length ? <Later moments={moments} arrival={arrival} /> : null}

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={share} className="rounded-xl border border-rule bg-card px-4 py-2 text-[13px] font-semibold text-ink">
              {copied ? "Link copied" : "Copy link"}
            </button>
          </div>
        </>
      ) : null}

      <p className="mt-3 border-t border-rule pt-3 text-[12px] leading-relaxed text-muted">
        Shows where free parking is allowed, not whether a space is empty — no city publishes that. The sign on the street always wins.
        Public holidays are treated like working days, so on a holiday you may have longer than this says.
        {data ? ` City of Zurich parking data from ${data.stand.split("-").reverse().join(".")} (CC0).` : ""} Map and address search © swisstopo. Place search © OpenStreetMap contributors, via Photon.
      </p>
    </div>
  );
}

function Instruction({ option, arrival }: { option: Option; arrival: Wall }) {
  const { spot, disc, until } = option;
  const isBlue = spot.kind === "blue";
  const dist = Math.round(spot.dist / 10) * 10;
  return (
    <div className={`rounded-[18px] p-4 ${isBlue ? "bg-blue-soft" : "bg-green-soft"}`}>
      <div className="flex items-center gap-2">
        <span className={`grid h-7 w-7 flex-none place-items-center rounded-md text-[17px] font-extrabold text-white ${isBlue ? "bg-blue" : "bg-green"}`}>P</span>
        <span className="text-[12px] text-muted">
          {isBlue ? "Blue zone" : "Paid space, no fee now"} · {dist} m · about {walkMinutes(spot.dist)} min walk · {carsLabel(spot.spaces)}
        </span>
      </div>
      <h2 className="mb-2.5 mt-1.5 text-[26px] font-bold leading-[1.1] tracking-[-.01em]">
        {spot.street ? `Park on ${spot.street}.` : `Park in the ${isBlue ? "blue zone" : "paid spaces"} ${dist} m away.`}
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {isBlue ? (
          <Step label="Set your disc to" value={disc === null ? "No disc needed" : hhmm(disc)} small={disc === null} />
        ) : (
          <Step label="Time limit" value="Check the sign" small />
        )}
        <Step label={isBlue ? "Move the car by" : "Pay nothing until"} value={when(until, arrival)} small={dayWord(until, arrival) !== "today"} />
      </div>
      <div className="mt-3">
        <MapsButtons spot={spot} />
      </div>
    </div>
  );
}

/* Copy the exact spot for Google Maps, or open it there directly. On a phone
 * the link opens the Maps app; the copy is for people who plan on a laptop and
 * paste into the Maps search box. */
function MapsButtons({ spot, compact }: { spot: Spot; compact?: boolean }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const text = mapsText(spot);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2500);
  };
  const label = copied === "done" ? "Copied" : copied === "failed" ? text : compact ? "Copy" : "Copy for Google Maps";
  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "justify-end" : ""}`}>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${text} for Google Maps`}
        className={`rounded-lg font-semibold ${compact ? "border border-rule bg-card px-2.5 py-1 text-[12px] text-ink" : "bg-ink px-3.5 py-2 text-[14px] text-white"}`}
      >
        {label}
      </button>
      <a
        href={mapsLink(spot)}
        target="_blank"
        rel="noopener noreferrer"
        className={`rounded-lg font-semibold ${compact ? "px-1 py-1 text-[12px] text-blue" : "border border-rule bg-card px-3.5 py-2 text-[14px] text-ink"}`}
      >
        {compact ? "Maps" : "Open in Google Maps"}
      </a>
      {!compact ? <span className="w-full text-[12px] text-muted">Pastes as {text} — the exact spot, not just the street.</span> : null}
    </div>
  );
}

function Step({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl bg-card p-2.5">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={`font-extrabold ${small ? "text-[17px] leading-tight" : "text-[24px]"}`}>{value}</div>
    </div>
  );
}

function Nothing({ spots, stayLabel, arrival, shorter }: { spots: number; stayLabel: string; arrival: Wall; shorter: Option | null }) {
  return (
    <div className="rounded-[18px] bg-card p-4">
      <h2 className="text-[22px] font-bold leading-tight">
        {spots === 0 ? "No free parking in the city data within 1 km." : `Nothing free for ${stayLabel.toLowerCase()} here at ${hhmm(arrival)}.`}
      </h2>
      {shorter ? (
        <p className="mt-2 text-[14px] text-body">
          Shorter works: {shorter.spot.street ?? "a blue zone"}, {Math.round(shorter.spot.dist / 10) * 10} m away
          {shorter.disc !== null ? `, disc ${hhmm(shorter.disc)}` : ""}, until {when(shorter.until, arrival)}.
        </p>
      ) : spots === 0 ? (
        <p className="mt-2 text-[14px] text-body">Try a place a little further from the centre, or another time.</p>
      ) : null}
    </div>
  );
}

const MOMENT_TEXT: Record<Moment["kind"], (m: Moment, a: Wall) => { when: string; what: string; why: string }> = {
  lunch: (m) => ({ when: "Arrive 11:30 – 13:29", what: "Stay until 14:30", why: `The blue zone lunch rule. ${m.spot.street ?? "Blue zone"}, ${Math.round(m.spot.dist / 10) * 10} m.` }),
  "blue-evening": (m, a) => ({ when: `From ${hhmm(m.at)}`, what: "Every blue zone, no disc", why: `${m.spot.street ?? "Blue zone"}, ${Math.round(m.spot.dist / 10) * 10} m. Until ${when(m.until, a)}.` }),
  "paid-evening": (m, a) => ({ when: `From ${hhmm(m.at)}`, what: "Paid spaces, no fee", why: `${m.spot.street ?? "Paid spaces"}, ${Math.round(m.spot.dist / 10) * 10} m. Until ${when(m.until, a)}. Check the sign for a time limit.` }),
  sunday: () => ({ when: "Sunday", what: "Blue zones all day, no limit", why: "Unless a sign on the street says otherwise." }),
};

function Later({ moments, arrival }: { moments: Moment[]; arrival: Wall }) {
  return (
    <section className="mt-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.14em] text-muted">Later, it gets free</p>
      <ol className="relative ml-2 border-l-2 border-rule pl-5">
        {moments.map((m) => {
          const t = MOMENT_TEXT[m.kind](m, arrival);
          const free = m.kind === "blue-evening" || m.kind === "paid-evening" || m.kind === "sunday";
          return (
            <li key={`${m.kind}${m.at}`} className="relative mb-3.5">
              <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full border-[3px] bg-card ${free ? "border-green" : "border-blue"}`} />
              <div className="text-[12px] font-bold uppercase tracking-[.04em] text-muted">{t.when}</div>
              <div className="text-[15px] font-semibold">{t.what}</div>
              <div className="text-[13px] text-body">{t.why}</div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TimePicker({ value, isNow, onChange, onNow }: { value: Wall; isNow: boolean; onChange: (w: Wall) => void; onNow: () => void }) {
  const [date, setDate] = useState(isoDate(value));
  const [time, setTime] = useState(hhmm(value));
  useEffect(() => {
    if (/^\d{4}-\d\d-\d\d$/.test(date) && /^\d\d:\d\d$/.test(time)) onChange(wallFromLocal(date, time));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, time]);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-card p-3">
      <label className="flex flex-col text-[12px] text-muted">
        Day
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 rounded-lg border border-rule px-2 py-1.5 text-[14px] text-ink" />
      </label>
      <label className="flex flex-col text-[12px] text-muted">
        Arriving at
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 rounded-lg border border-rule px-2 py-1.5 text-[14px] text-ink" />
      </label>
      {!isNow ? (
        <button type="button" onClick={onNow} className="rounded-lg border border-rule px-3 py-1.5 text-[13px] text-body">Back to now</button>
      ) : null}
    </div>
  );
}

function Empty({ onPick }: { onPick: (d: Dest) => void }) {
  return (
    <div className="rounded-2xl bg-card p-4">
      <p className="text-[14px] text-body">Try one:</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLES.map((e) => (
          <button key={e.label} type="button" onClick={() => onPick(e)} className="rounded-full border border-rule px-3 py-1.5 text-[13px] text-ink">
            {e.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* OpenStreetMap features that are never a destination someone types. */
const NOISE = /^(emergency|highway|barrier|power|man_made|landuse|boundary)$/;
const NOISE_VALUE = /^(platform|tram_stop|bus_stop|subway_entrance|stop_position|atm|bicycle_rental|vending_machine|waste_basket|bench|telephone|post_box|recycling|parking_entrance|board|charging_station)$/;

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; street?: string; housenumber?: string; postcode?: string; city?: string; osm_key?: string; osm_value?: string; countrycode?: string };
};

async function searchPlaces(text: string): Promise<Dest[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&lat=47.3769&lon=8.5417&limit=15&lang=de&bbox=5.95,45.81,10.50,47.81`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const json = (await res.json()) as { features?: PhotonFeature[] };
  return (json.features ?? [])
    .filter((f) => f.properties.countrycode === "CH" && !NOISE.test(f.properties.osm_key ?? "") && !NOISE_VALUE.test(f.properties.osm_value ?? ""))
    .map((f) => {
      const p = f.properties;
      const street = [p.street, p.housenumber].filter(Boolean).join(" ");
      const where = [street, [p.postcode, p.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      const label = p.name ? (where ? `${p.name}, ${where}` : p.name) : where;
      return { label, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], city: p.city };
    })
    .filter((d) => d.label);
}

async function searchAddresses(text: string): Promise<Dest[]> {
  const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&origins=address&sr=4326&limit=6&searchText=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  const json = (await res.json()) as { results?: { attrs: { label: string; lat: number; lon: number } }[] };
  return (json.results ?? []).map((r) => {
    const label = cleanLabel(r.attrs.label);
    // "Hohlstrasse 201 8004 Zürich": the town is what follows the postcode.
    const city = /\b\d{4}\s+(.+)$/.exec(label)?.[1];
    return { label, lat: r.attrs.lat, lon: r.attrs.lon, city };
  });
}

function Search({ onPick, current }: { onPick: (d: Dest) => void; current: Dest | null }) {
  const [q, setQ] = useState(current?.label ?? "");
  const [results, setResults] = useState<Dest[]>([]);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState<"idle" | "busy" | "denied">("idle");
  const seq = useRef(0);

  useEffect(() => { if (current) setQ(current.label); }, [current]);

  /* Search, debounced 350 ms, from 3 characters.

     Main source: Photon (photon.komoot.io), OpenStreetMap data. It knows
     shops, museums, venues — "Apple Store", "Migros Oerlikon". The first
     version used only swisstopo's SearchServer, which knows addresses, place
     names and stops but no businesses: on a phone, "Apple basel" offered the
     city of Basel and "Heidi-Abel-Weg" (a fuzzy match on "Abel"), never the
     Apple Store on Freie Strasse.

     Second source, only when the text contains a digit: swisstopo, for exact
     Swiss addresses. Results are limited to Switzerland and biased to Zurich;
     a place outside the city stays visible, marked, and picking it says
     "Only Zurich so far" — never swapped for a Zurich lookalike. */
  useEffect(() => {
    const text = q.trim();
    if (!open || text.length < 3) { setResults([]); return; }
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const hasNumber = /\d/.test(text);
        const [places, addresses] = await Promise.all([
          searchPlaces(text).catch(() => [] as Dest[]),
          hasNumber ? searchAddresses(text).catch(() => [] as Dest[]) : Promise.resolve([] as Dest[]),
        ]);
        /* "Bahnhofstrasse 1" exists in hundreds of Swiss towns, and as typed
           it came back as Goldau, Eschenz, Elgg. If the text names no town
           that any result is in, the visitor almost certainly means Zurich:
           ask swisstopo again with "Zürich" and list those first. If it does
           name a town ("… Winterthur"), leave it alone. */
        const lower = text.toLowerCase();
        const namesATown = /z(ü|ue|u)rich/.test(lower) || [...places, ...addresses].some((d) => d.city && d.city.length > 2 && lower.includes(d.city.toLowerCase()));
        const zurichAddresses = hasNumber && !namesATown ? await searchAddresses(`${text} Zürich`).catch(() => [] as Dest[]) : [];
        if (id !== seq.current) return;
        const seen = new Set<string>();
        const list: Dest[] = [];
        for (const d of [...zurichAddresses.filter(isZurichCity), ...addresses.filter(isZurichCity), ...places, ...addresses]) {
          const k = d.label.toLowerCase().replace(/[,\s]+/g, " ");
          if (!d.label || seen.has(k)) continue;
          seen.add(k);
          list.push(d);
          if (list.length === 6) break;
        }
        setResults(list);
      } catch {
        if (id === seq.current) setResults([]);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q, open]);

  const locate = () => {
    if (!navigator.geolocation) return setLocating("denied");
    setLocating("busy");
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating("idle"); onPick({ label: "Where I am", lat: p.coords.latitude, lon: p.coords.longitude }); },
      () => setLocating("denied"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className="relative">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (results[0]) { onPick(results[0]); setOpen(false); (document.activeElement as HTMLElement | null)?.blur(); }
        }}
      >
      <label htmlFor="dest" className="sr-only">Where are you going in Zurich?</label>
      <input
        id="dest"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        placeholder="Where are you going? A shop, a place, a street"
        autoComplete="off"
        enterKeyHint="search"
        className="w-full rounded-xl border border-rule bg-card px-3 py-2.5 text-[15px] text-ink placeholder:text-muted"
      />
      </form>
      {open && results.length ? (
        <ul className="absolute z-[1000] mt-1 w-full overflow-hidden rounded-xl border border-rule bg-card shadow-lg" role="listbox">
          {results.map((r) => (
            <li key={`${r.label}${r.lat}`}>
              <button type="button" onClick={() => { onPick(r); setOpen(false); }} className="w-full px-3 py-2.5 text-left text-[14px] hover:bg-ground">
                {/* The note gets its own line. Inline after a long address, a phone
                    broke "outside Zurich" across two lines, and "Zurich" alone under
                    "…4001 Basel" read as the place's town. */}
                <span className="block">{r.label}</span>
                {!isZurichCity(r) ? <span className="mt-0.5 block text-[12px] text-muted">Not in Zurich — no parking data there yet</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" onClick={locate} className="mt-2 text-[13px] font-semibold text-blue">
        {locating === "busy" ? "Finding you…" : locating === "denied" ? "Location refused — type a place instead" : "Use where I am"}
      </button>
    </div>
  );
}
