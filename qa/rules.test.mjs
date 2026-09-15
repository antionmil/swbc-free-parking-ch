/* The rules, attacked with the worked examples from prep/rules.md.
 *   node --experimental-strip-types --no-warnings qa/rules.test.mjs
 * Dates are real: 15 Sept 2026 is a Tuesday. */
import { blue, discTime, hhmm, paid, wallFromLocal, weekday, dayName, wallFromDate } from "../src/lib/rules.ts";

let bad = 0;
const at = (date, time) => wallFromLocal(date, time);
const show = (w) => (w === null ? "none" : `${dayName(w).slice(0, 3)} ${hhmm(w)}`);
function eq(label, got, want) {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${got}${ok ? "" : `  (want ${want})`}`);
}

eq("2026-09-15 is a Tuesday", dayName(at("2026-09-15", "12:00")), "Tuesday");

// Blue zone
let b = blue(at("2026-09-15", "10:07"));
eq("Tue 10:07 disc", show(b.disc), "Tue 10:30");
eq("Tue 10:07 move by", show(b.until), "Tue 11:30");

b = blue(at("2026-09-15", "10:30"));
eq("Tue 10:30 exactly: same mark (earlier, safer)", show(b.disc), "Tue 10:30");

b = blue(at("2026-09-15", "12:10"));
eq("Tue 12:10 lunch rule move by", show(b.until), "Tue 14:30");
b = blue(at("2026-09-15", "11:29"));
eq("Tue 11:29 is NOT lunch: disc 11:30, move by", show(b.until), "Tue 12:30");
b = blue(at("2026-09-15", "13:29"));
eq("Tue 13:29 is lunch: disc 13:30 → 14:30", show(b.until), "Tue 14:30");
b = blue(at("2026-09-15", "13:30"));
eq("Tue 13:30 is not lunch: 14:30 from the disc anyway", show(b.until), "Tue 14:30");
b = blue(at("2026-09-15", "13:31"));
eq("Tue 13:31 disc 14:00 → 15:00", show(b.until), "Tue 15:00");

b = blue(at("2026-09-15", "14:10"));
eq("Tue 14:10 (the mockup) disc", show(b.disc), "Tue 14:30");
eq("Tue 14:10 (the mockup) move by", show(b.until), "Tue 15:30");

b = blue(at("2026-09-15", "18:10"));
eq("Tue 18:10 disc 18:30, limit ends 19:00 → free until", show(b.until), "Wed 08:00");

b = blue(at("2026-09-19", "18:40"));
eq("Sat 18:40 → free until Monday 08:00 (Sunday has no limit)", show(b.until), "Mon 08:00");

b = blue(at("2026-09-20", "10:00"));
eq("Sun 10:00 no disc", show(b.disc), "none");
eq("Sun 10:00 free until", show(b.until), "Mon 08:00");

b = blue(at("2026-09-15", "21:00"));
eq("Tue 21:00 no disc, until", show(b.until), "Wed 08:00");

b = blue(at("2026-09-16", "07:10"));
eq("Wed 07:10 disc 07:30", show(b.disc), "Wed 07:30");
eq("Wed 07:10 until 08:30 (disc + 1 h beats 08:00)", show(b.until), "Wed 08:30");
b = blue(at("2026-09-16", "05:00"));
eq("Wed 05:00 no disc needed", show(b.disc), "none");
eq("Wed 05:00 until 08:00", show(b.until), "Wed 08:00");

eq("disc for 09:59", hhmm(discTime(at("2026-09-15", "09:59"))), "10:00");
eq("disc for 23:40 rolls to midnight", hhmm(discTime(at("2026-09-15", "23:40"))), "00:00");

// Paid spaces, Zurich's common meter schedule
const moSa = { days: "Mo-Sa", from: 540, to: 1200, maxMin: 120 };
let p = paid(moSa, at("2026-09-15", "14:10"));
eq("Tue 14:10 paid now", p.free, false);
eq("Tue 14:10 no fee from", show(p.freeFrom), "Tue 20:00");
p = paid(moSa, at("2026-09-15", "20:00"));
eq("Tue 20:00 free", p.free, true);
eq("Tue 20:00 free until", show(p.until), "Wed 09:00");
p = paid(moSa, at("2026-09-19", "21:00"));
eq("Sat 21:00 free until Monday 09:00", show(p.until), "Mon 09:00");
p = paid(moSa, at("2026-09-20", "12:00"));
eq("Sun 12:00 free", p.free, true);
p = paid(moSa, at("2026-09-15", "08:59"));
eq("Tue 08:59 free until 09:00", show(p.until), "Tue 09:00");
const moSo = { days: "Mo-So", from: 480, to: 1140, maxMin: 240 };
p = paid(moSo, at("2026-09-20", "12:00"));
eq("Sun 12:00 on a Mo-So meter is paid", p.free, false);

// Time zone at the edge: 15 Sept 2026 12:00 UTC is 14:00 in Zurich (summer time)
eq("UTC → Zurich wall clock", hhmm(wallFromDate(new Date("2026-09-15T12:00:00Z"))), "14:00");
eq("winter time: 15 Dec 12:00 UTC → 13:00", hhmm(wallFromDate(new Date("2026-12-15T12:00:00Z"))), "13:00");

console.log(bad ? `\n${bad} failed` : "\nall rules pass");
process.exit(bad ? 1 : 0);
