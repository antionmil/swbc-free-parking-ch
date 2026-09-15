/* THE RULES. Pure functions, no DOM, tested in qa/rules.test.mjs.
 *
 * Every rule here has a source in ../../prep/rules.md. Where the law or the
 * data is unclear, the code picks the answer that sends nobody to a ticket:
 * an earlier "move by", never a later one.
 *
 * Time is Zurich wall-clock time in whole minutes ("Wall"). Converting at the
 * edges only (wallFromDate / labels) keeps every rule simple arithmetic. The
 * cost: on the two clock-change nights a time can be off by an hour. No rule
 * here changes at 02:00–03:00, so no answer changes because of it. */

export type Wall = number; // minutes since 1970-01-01 00:00, Zurich wall clock

export type Schedule = { days: "Mo-Sa" | "Mo-So"; from: number; to: number; maxMin: number };

const DAY = 1440;

export function wallFromDate(d: Date): Wall {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return Math.floor(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) / 60000);
}

export function wallFromLocal(date: string, time: string): Wall {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, hh, mm) / 60000);
}

const asDate = (w: Wall) => new Date(w * 60000);
export const minuteOfDay = (w: Wall) => ((w % DAY) + DAY) % DAY;
export const dayStart = (w: Wall) => w - minuteOfDay(w);
/** 0 = Sunday … 6 = Saturday */
export const weekday = (w: Wall) => asDate(w).getUTCDay();

export const hhmm = (w: Wall) => {
  const m = minuteOfDay(w);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const dayName = (w: Wall) => DAYS[weekday(w)];
export const shortDay = (w: Wall) => DAYS[weekday(w)].slice(0, 3);
export const isoDate = (w: Wall) => asDate(w).toISOString().slice(0, 10);

/** "Today", "Tomorrow", or the weekday name, relative to `from`. */
export function dayWord(w: Wall, from: Wall) {
  const diff = (dayStart(w) - dayStart(from)) / DAY;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return dayName(w);
}

/* ---------- Blue zone (SSV Art. 48; Stadt Winterthur) ---------- */

/** Working days are Monday to Saturday. Public holidays are NOT modelled:
 *  a holiday is treated like a working day, which can only make the answer
 *  stricter than the law, never looser. */
const workingDay = (w: Wall) => weekday(w) !== 0;
const LIMIT_FROM = 8 * 60;
const LIMIT_TO = 19 * 60;

/** Is the blue-zone limit in force at this minute? */
export const blueLimited = (w: Wall) => workingDay(w) && minuteOfDay(w) >= LIMIT_FROM && minuteOfDay(w) < LIMIT_TO;

/** The next moment the blue-zone limit starts, strictly after `w`. */
export function nextBlueStart(w: Wall): Wall {
  let d = dayStart(w);
  if (minuteOfDay(w) >= LIMIT_FROM) d += DAY;
  while (!workingDay(d)) d += DAY;
  return d + LIMIT_FROM;
}

/** The disc is set to the next hour or half-hour mark after arrival. On an
 *  exact mark the same mark is used: the earlier choice, so "move by" is never
 *  later than the law allows. */
export const discTime = (arrival: Wall) => Math.ceil(arrival / 30) * 30;

export type BlueAnswer = {
  /** time to show on the disc, or null when no disc is needed */
  disc: Wall | null;
  /** latest time the car may stay */
  until: Wall;
};

export function blue(arrival: Wall): BlueAnswer {
  if (!blueLimited(arrival)) {
    const start = nextBlueStart(arrival);
    // Before 08:00 on a working day the limit starts within hours. Setting
    // the disc on arrival buys one hour from the disc time; count only what
    // is certain: the later of the limit start and disc + 60.
    if (workingDay(arrival) && minuteOfDay(arrival) < LIMIT_FROM) {
      const d = discTime(arrival);
      return { disc: d + 60 > start ? d : null, until: Math.max(start, d + 60) };
    }
    return { disc: null, until: start };
  }
  const d = discTime(arrival);
  let until = d + 60;
  const m = minuteOfDay(arrival);
  if (m >= 11 * 60 + 30 && m <= 13 * 60 + 29) until = Math.max(until, dayStart(arrival) + 14 * 60 + 30);
  // Once the limit ends at 19:00 the car may stay until it starts again.
  if (until > dayStart(arrival) + LIMIT_TO) until = nextBlueStart(dayStart(arrival) + LIMIT_TO);
  return { disc: d, until };
}

/* ---------- Paid spaces, free outside meter hours ---------- */

const paidDay = (s: Schedule, w: Wall) => s.days === "Mo-So" || workingDay(w);

export const paidNow = (s: Schedule, w: Wall) => paidDay(s, w) && minuteOfDay(w) >= s.from && minuteOfDay(w) < s.to;

/** When paying starts next, at or after `w`. */
export function nextPaidStart(s: Schedule, w: Wall): Wall {
  let d = dayStart(w);
  for (let i = 0; i < 8; i++, d += DAY) {
    const start = d + s.from;
    if (paidDay(s, d) && start >= w) return start;
  }
  throw new Error("schedule never starts");
}

/** When the current paid period ends (only meaningful while paidNow). */
export const paidEnds = (s: Schedule, w: Wall) => dayStart(w) + s.to;

export type PaidAnswer = { free: true; until: Wall } | { free: false; freeFrom: Wall };

export function paid(s: Schedule, arrival: Wall): PaidAnswer {
  if (paidNow(s, arrival)) return { free: false, freeFrom: paidEnds(s, arrival) };
  return { free: true, until: nextPaidStart(s, arrival) };
}

/* ---------- Distance ---------- */

export function metres(a: [number, number], b: [number, number]) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Streets are not straight lines: 1.3 × the straight distance at 80 m a
 *  minute. Shown as "about", never as a route. */
export const walkMinutes = (m: number) => Math.max(1, Math.ceil((m * 1.3) / 80));

/** A spot stretch in cars, for "about N cars". */
export const carsLabel = (spaces: number) => (spaces <= 1 ? "1 car" : `about ${spaces} cars`);
