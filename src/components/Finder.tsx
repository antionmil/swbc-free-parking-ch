"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { answer, laterToday, nearby, RADIUS, type DataFile, type Moment, type Option } from "@/lib/finder";
import { carsLabel, dayStart, dayWord, hhmm, isoDate, shortDay, wallFromDate, wallFromLocal, walkMinutes, type Wall } from "@/lib/rules";

const MapStrip = dynamic(() => import("./MapStrip"), { ssr: false, loading: () => <div className="h-40 w-full rounded-2xl bg-rule" /> });

type Dest = { label: string; lat: number; lon: number };

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
  const [nowWall, setNowWall] = useState<Wall>(() => wallFromDate(new Date()));
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

  const arrival = picked ?? nowWall;
  const minutes = stayMinutes(stay, arrival);
  const covered = dest ? inZurich(dest.lat, dest.lon) : true;
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
          {picked === null ? `Now · ${shortDay(arrival)} ${hhmm(arrival)}` : `${shortDay(arrival)} ${hhmm(arrival)}`}
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
      ) : !data ? (
        <div className="h-48 animate-pulse rounded-2xl bg-card" aria-label="Loading parking data" />
      ) : best ? (
        <Instruction option={best} arrival={arrival} />
      ) : (
        <Nothing spots={spots.length} stayLabel={STAYS.find((s) => s.key === stay)!.label} arrival={arrival} shorter={result.shorter} />
      )}

      {dest && covered && data ? (
        <>
          <MapStrip dest={[dest.lat, dest.lon]} chosen={best ?? result.shorter} others={result.fits.slice(1)} />

          {result.fits.length > 1 ? (
            <section>
              <p className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-[.14em] text-muted">If it&rsquo;s full</p>
              {result.fits.slice(1).map((o) => (
                <div key={`${o.spot.lat},${o.spot.lon}`} className="flex items-baseline justify-between gap-3 border-b border-rule py-2.5 text-[14px]">
                  <span className="font-medium">{o.spot.street ?? "Unnamed street"}</span>
                  <span className="text-right text-[12px] text-muted">
                    {Math.round(o.spot.dist / 10) * 10} m · {o.spot.kind === "blue" ? "blue zone" : "no fee now"} · {carsLabel(o.spot.spaces)} · until {when(o.until, arrival)}
                  </span>
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
        {data ? ` City of Zurich parking data from ${data.stand.split("-").reverse().join(".")} (CC0).` : ""} Map and search © swisstopo.
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

function Search({ onPick, current }: { onPick: (d: Dest) => void; current: Dest | null }) {
  const [q, setQ] = useState(current?.label ?? "");
  const [results, setResults] = useState<Dest[]>([]);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState<"idle" | "busy" | "denied">("idle");
  const seq = useRef(0);

  useEffect(() => { if (current) setQ(current.label); }, [current]);

  // swisstopo search, debounced: fair use is 20 requests a minute.
  useEffect(() => {
    const text = q.trim();
    if (!open || text.length < 3) { setResults([]); return; }
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&sr=4326&limit=15&searchText=${encodeURIComponent(`${text} Zürich`)}`;
        const res = await fetch(url);
        const json = (await res.json()) as { results?: { attrs: { label: string; lat: number; lon: number } }[] };
        if (id !== seq.current) return;
        const seen = new Set<string>();
        const list: Dest[] = [];
        for (const r of json.results ?? []) {
          const label = cleanLabel(r.attrs.label);
          if (!label || seen.has(label) || !inZurich(r.attrs.lat, r.attrs.lon)) continue;
          seen.add(label);
          list.push({ label, lat: r.attrs.lat, lon: r.attrs.lon });
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
      <label htmlFor="dest" className="sr-only">Where are you going in Zurich?</label>
      <input
        id="dest"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) { onPick(results[0]); setOpen(false); }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Where are you going in Zurich?"
        autoComplete="off"
        className="w-full rounded-xl border border-rule bg-card px-3 py-2.5 text-[15px] text-ink placeholder:text-muted"
      />
      {open && results.length ? (
        <ul className="absolute z-[1000] mt-1 w-full overflow-hidden rounded-xl border border-rule bg-card shadow-lg" role="listbox">
          {results.map((r) => (
            <li key={`${r.label}${r.lat}`}>
              <button type="button" onClick={() => { onPick(r); setOpen(false); }} className="w-full px-3 py-2.5 text-left text-[14px] hover:bg-ground">
                {r.label}
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
