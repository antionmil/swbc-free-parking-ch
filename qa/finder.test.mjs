/* The page's decisions against the REAL data file, for real places.
 *   node --experimental-strip-types --no-warnings qa/finder.test.mjs
 * Needs public/data/zurich.json (pnpm data). Street names can change when the
 * city changes its data; the rule-shaped checks (times, kinds) must not. */
import { readFileSync } from "node:fs";
import { answer, laterToday, nearby } from "../src/lib/finder.ts";
import { hhmm, wallFromLocal, dayName } from "../src/lib/rules.ts";

const data = JSON.parse(readFileSync("public/data/zurich.json", "utf8"));
const kunsthaus = [47.37022, 8.54798];
let bad = 0;
const eq = (label, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${got}${ok ? "" : `  (want ${want})`}`); };
const at = (d, t) => wallFromLocal(d, t);
const spots = nearby(data, kunsthaus);

let a = answer(spots, at("2026-09-15", "14:10"), 60);
eq("Kunsthaus Tue 14:10 1 h: kind", a.fits[0]?.spot.kind, "blue");
eq("… disc", hhmm(a.fits[0].disc), "14:30");
eq("… move by", hhmm(a.fits[0].until), "15:30");
eq("… nearest blue within 300 m", a.fits[0].spot.dist < 300, true);

a = answer(spots, at("2026-09-15", "14:10"), 120);
eq("Kunsthaus Tue 14:10 2 h: nothing fits", a.fits.length, 0);
eq("… but a shorter option is offered", a.shorter?.spot.kind, "blue");

a = answer(spots, at("2026-09-20", "11:00"), 180);
eq("Kunsthaus Sun 11:00 3 h: something fits", a.fits.length > 0, true);
eq("… every option lasts until Monday", a.fits.every((o) => dayName(o.until) === "Monday"), true);

const later = laterToday(spots, at("2026-09-15", "14:10")).map((m) => `${m.kind}@${hhmm(m.at)}`).join(" ");
eq("Kunsthaus Tue 14:10 later", later, "blue-evening@19:00 paid-evening@20:00 sunday@00:00");
eq("Sat 18:40: no separate Sunday moment", laterToday(spots, at("2026-09-19", "18:40")).some((m) => m.kind === "sunday"), false);

const far = nearby(data, [46.948, 7.4474]);
eq("Bern: no spots", far.length, 0);

// Nothing listed may be a paid space that is being charged at the time.
const charged = answer(spots, at("2026-09-15", "10:00"), 30).fits.filter((o) => o.spot.kind === "paid");
eq("Tue 10:00: no paid space offered while meters run", charged.length, 0);

console.log(bad ? `\n${bad} failed` : "\nall finder checks pass");
process.exit(bad ? 1 : 0);
