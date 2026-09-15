/* From the data file and a destination to what the page says. Pure, like
 * rules.ts: the page only renders what these functions return. */
import {
  blue, blueLimited, dayStart, metres, minuteOfDay, nextBlueStart, nextPaidStart, paid, paidEnds, paidNow,
  weekday, type Schedule, type Wall,
} from "./rules.ts";

export type DataFile = {
  city: string;
  stand: string;
  built: string;
  source: string;
  streets: string[];
  schedules: Schedule[];
  spots: [number, number, 0 | 1, number, number, number][];
};

export type Spot = {
  lat: number;
  lon: number;
  kind: "blue" | "paid";
  spaces: number;
  street: string | null;
  schedule: Schedule | null;
  dist: number;
};

export type Option = { spot: Spot; disc: Wall | null; until: Wall };

/** How far a driver will walk for free parking. Past this, the page says so
 *  rather than sending someone 2 km. */
export const RADIUS = 1000;

export function nearby(data: DataFile, dest: [number, number], radius = RADIUS): Spot[] {
  const out: Spot[] = [];
  // Cheap box first: at Zurich's latitude 0.01° lat ≈ 1.1 km, 0.01° lon ≈ 750 m.
  const dLat = radius / 111000, dLon = radius / 75000;
  for (const [lat, lon, k, spaces, si, sch] of data.spots) {
    if (Math.abs(lat - dest[0]) > dLat || Math.abs(lon - dest[1]) > dLon) continue;
    const dist = metres(dest, [lat, lon]);
    if (dist > radius) continue;
    out.push({ lat, lon, kind: k === 0 ? "blue" : "paid", spaces, street: si >= 0 ? data.streets[si] : null, schedule: sch >= 0 ? data.schedules[sch] : null, dist });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

/** Is parking free at this spot on arrival, and until when? */
export function optionAt(spot: Spot, arrival: Wall): Option | null {
  if (spot.kind === "blue") {
    const b = blue(arrival);
    return { spot, disc: b.disc, until: b.until };
  }
  if (!spot.schedule) return null;
  const p = paid(spot.schedule, arrival);
  return p.free ? { spot, disc: null, until: p.until } : null;
}

export type Answer = {
  /** free for the whole stay, nearest first, one per street */
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
    if (!o || o.until <= arrival) continue;
    if (o.until - arrival >= stayMin) {
      const key = `${spot.kind}|${spot.street ?? `${spot.lat},${spot.lon}`}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fits.push(o);
      if (fits.length === 4) break;
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
