/* From the data file and a destination to what the page says. Pure, like
 * rules.ts: the page only renders what these functions return. */
import {
  blue, blueLimited, dayStart, discTime, metres, minuteOfDay, nextBlueStart, nextPaidStart, paid, paidEnds, paidNow,
  weekday, type Schedule, type Wall,
} from "./rules.ts";

export type DataFile = {
  city: string;
  /** true when spots are placed along their street, not at the exact space (Basel) */
  approx?: boolean;
  /** the city's own data date, or the day it was fetched when the source has none */
  stand: string;
  dated?: "stand" | "fetched";
  source: string;
  streets: string[];
  schedules: Schedule[];
  /** [lat, lon, kind, spaces, street index, extra]
   *  kind 0 blue zone · 1 paid (extra = schedule index) · 2 free, no limit ·
   *  3 free with a disc for `extra` minutes */
  spots: [number, number, 0 | 1 | 2 | 3, number, number, number][];
};

export type Kind = "blue" | "paid" | "free" | "limited";
const KINDS: Kind[] = ["blue", "paid", "free", "limited"];

export type Spot = {
  lat: number;
  lon: number;
  kind: Kind;
  spaces: number;
  street: string | null;
  schedule: Schedule | null;
  /** only for "limited": how long the disc allows */
  maxMin: number | null;
  dist: number;
};

/** `until` is null when there is no time limit at all. */
export type Option = { spot: Spot; disc: Wall | null; until: Wall | null };

/** No limit is longer than any stay the page offers. */
const NO_LIMIT = 7 * 1440;

/** How far a driver will walk for free parking. Past this, the page says so
 *  rather than sending someone 2 km. */
export const RADIUS = 1000;

export function nearby(data: DataFile, dest: [number, number], radius = RADIUS): Spot[] {
  const out: Spot[] = [];
  // Cheap box first: at Zurich's latitude 0.01° lat ≈ 1.1 km, 0.01° lon ≈ 750 m.
  const dLat = radius / 111000, dLon = radius / 75000;
  for (const [lat, lon, k, spaces, si, extra] of data.spots) {
    if (Math.abs(lat - dest[0]) > dLat || Math.abs(lon - dest[1]) > dLon) continue;
    const dist = metres(dest, [lat, lon]);
    if (dist > radius) continue;
    const kind = KINDS[k];
    out.push({
      lat, lon, kind, spaces, dist,
      street: si >= 0 ? data.streets[si] : null,
      schedule: kind === "paid" && extra >= 0 ? data.schedules[extra] : null,
      maxMin: kind === "limited" && extra > 0 ? extra : null,
    });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

/** Is parking free at this spot on arrival, and until when? */
export function optionAt(spot: Spot, arrival: Wall): Option | null {
  if (spot.kind === "blue") {
    const b = blue(arrival);
    return { spot, disc: b.disc, until: b.until };
  }
  if (spot.kind === "free") return { spot, disc: null, until: null };
  if (spot.kind === "limited") {
    if (!spot.maxMin) return null;
    // The hours this limit applies are not in the data: count it as always on.
    const d = discTime(arrival);
    return { spot, disc: d, until: d + spot.maxMin };
  }
  if (!spot.schedule) return null;
  const p = paid(spot.schedule, arrival);
  return p.free ? { spot, disc: null, until: p.until } : null;
}

export type Answer = {
  /** free for the whole stay, nearest first, one per street, at most 7 */
  fits: Option[];
  /** nothing fits: the nearest free option, however short */
  shorter: Option | null;
};

export function answer(spots: Spot[], arrival: Wall, stayMin: number): Answer {
  const fits: Option[] = [];
  const seen = new Set<string>();
  let shorter: Option | null = null;
  for (const spot of spots) {
    const o = optionAt(spot, arrival);
    if (!o || (o.until !== null && o.until <= arrival)) continue;
    const length = o.until === null ? NO_LIMIT : o.until - arrival;
    if (length >= stayMin) {
      const key = `${spot.kind}|${spot.street ?? `${spot.lat},${spot.lon}`}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fits.push(o);
      if (fits.length === 7) break;
    } else if (!shorter) {
      shorter = o;
    }
  }
  return { fits, shorter: fits.length ? null : shorter };
}

export type Moment = {
  at: Wall;
  kind: "lunch" | "blue-evening" | "paid-evening" | "sunday";
  spot: Spot;
  until: Wall;
};

/** D: the moments later on when free parking opens up near the destination,
 *  each tied to the nearest real spot it applies to. */
export function laterToday(spots: Spot[], arrival: Wall): Moment[] {
  const out: Moment[] = [];
  const nearestBlue = spots.find((s) => s.kind === "blue");
  const today = dayStart(arrival);
  const working = weekday(arrival) !== 0;

  if (nearestBlue && working && minuteOfDay(arrival) < 11 * 60 + 30) {
    out.push({ at: today + 11 * 60 + 30, kind: "lunch", spot: nearestBlue, until: today + 14 * 60 + 30 });
  }
  if (nearestBlue && blueLimited(arrival)) {
    const at = today + 19 * 60;
    out.push({ at, kind: "blue-evening", spot: nearestBlue, until: nextBlueStart(at) });
  }
  const paidNowSpot = spots.find((s) => s.kind === "paid" && s.schedule && paidNow(s.schedule, arrival));
  if (paidNowSpot?.schedule) {
    const at = paidEnds(paidNowSpot.schedule, arrival);
    out.push({ at, kind: "paid-evening", spot: paidNowSpot, until: nextPaidStart(paidNowSpot.schedule, at) });
  }
  if (nearestBlue && working) {
    const sunday = today + ((7 - weekday(arrival)) % 7) * 1440;
    // Saturday evening already runs free through Sunday: saying so twice is noise.
    if (blue(arrival).until < sunday + 1440) {
      out.push({ at: sunday, kind: "sunday", spot: nearestBlue, until: sunday + 1440 + 8 * 60 });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** What gets pasted into Google Maps. The data has no house numbers, and a
 *  street name alone lands in the middle of the street — on a long one that
 *  can be half a kilometre off. Coordinates land on the spot. */
export const mapsText = (spot: Spot) => `${spot.lat.toFixed(5)}, ${spot.lon.toFixed(5)}`;

/** Google Maps URLs, documented form: opens the app on a phone. */
export const mapsLink = (spot: Spot) => `https://www.google.com/maps/search/?api=1&query=${spot.lat.toFixed(5)}%2C${spot.lon.toFixed(5)}`;

/* ---------- What the sign says, whatever time it is now ---------- */

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const daysWord = (d: Schedule["days"]) => (d === "Mo-Sa" ? "Mon–Sat" : "every day");

/** The rule at a spot, independent of the moment asked about. Free right now
 *  because it is Sunday is useful; knowing it is a blue zone on Tuesday is
 *  what tells someone whether to come back. */
export function ruleText(spot: Spot): string {
  switch (spot.kind) {
    case "blue":
      return "Blue zone: 1 hour with a disc, Mon–Sat 08:00–19:00. Free with no limit outside those hours.";
    case "limited": {
      const min = spot.maxMin ?? 0;
      const length = min % 60 === 0 ? `${min / 60} h` : `${min} min`;
      return `White zone: free with a disc, ${length} at a time. The data does not say which hours that limit applies, so the page treats it as always.`;
    }
    case "paid":
      return spot.schedule
        ? `Paid ${daysWord(spot.schedule.days)} ${clock(spot.schedule.from)}–${clock(spot.schedule.to)}. Free outside those hours.`
        : "Paid.";
    case "free":
      return "Free with no time limit, at any hour.";
  }
}
