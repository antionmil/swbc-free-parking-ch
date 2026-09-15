/* The page's decisions against the REAL data file, for real places.
 *   node --experimental-strip-types --no-warnings qa/finder.test.mjs
 * Needs public/data/zurich.json (pnpm data). Street names can change when the
 * city changes its data; the rule-shaped checks (times, kinds) must not. */
import { readFileSync } from "node:fs";
import { answer, laterToday, nearby, optionAt } from "../src/lib/finder.ts";
import { cityFor } from "../src/lib/cities.ts";
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

// ---- Geneva (SITG) ----
const geneve = JSON.parse(readFileSync("public/data/geneve.json", "utf8"));
const plainpalais = [46.19788, 6.14062];
const gs = nearby(geneve, plainpalais);
eq("Geneva: spots near Plainpalais", gs.length > 0, true);
a = answer(gs, at("2026-09-15", "14:10"), 60);
eq("Plainpalais Tue 14:10 1 h: something fits", a.fits.length > 0, true);
const blueHere = a.fits.find((o) => o.spot.kind === "blue");
if (blueHere) { eq("… a blue zone uses the national disc rule", hhmm(blueHere.disc), "14:30"); eq("… move by", hhmm(blueHere.until), "15:30"); }

// A free-with-no-limit stretch fits any stay, and says so with until = null.
const freeSpot = nearby(geneve, [geneve.spots.find((s) => s[2] === 2)[0], geneve.spots.find((s) => s[2] === 2)[1]], 50).find((s) => s.kind === "free");
eq("Geneva free, no limit: option until", optionAt(freeSpot, at("2026-09-15", "14:10")).until, null);
eq("… fits a 3-hour stay", answer([freeSpot], at("2026-09-15", "14:10"), 180).fits.length, 1);

// A free stretch with a limit counts the limit from the disc, at any hour.
const lim = geneve.spots.find((s) => s[2] === 3 && s[5] === 180);
const limSpot = nearby(geneve, [lim[0], lim[1]], 50).find((s) => s.kind === "limited" && s.maxMin === 180);
const lo = optionAt(limSpot, at("2026-09-15", "22:10"));
eq("Geneva 3 h limit at 22:10: disc", hhmm(lo.disc), "22:30");
eq("… move by (limit treated as always on)", hhmm(lo.until), "01:30");
eq("… does not fit a 4-hour stay", answer([limSpot], at("2026-09-15", "22:10"), 240).fits.length, 0);

// Which city's data a destination gets.
eq("cityFor Photon Geneva result", cityFor({ lat: 46.2, lon: 6.14, city: "Genève", state: "Genève" })?.id, "geneve");
eq("cityFor German names (Photon lang=de): Genf", cityFor({ lat: 46.198, lon: 6.141, city: "Genf", state: "Genf" })?.id, "geneve");
eq("cityFor Carouge (canton of Geneva)", cityFor({ lat: 46.184, lon: 6.140, city: "Carouge", state: "Genève" })?.id, "geneve");
eq("cityFor Zürich", cityFor({ lat: 47.37, lon: 8.54, city: "Zürich", state: "Zürich" })?.id, "zurich");
eq("cityFor Wallisellen: none", cityFor({ lat: 47.408, lon: 8.596, city: "Wallisellen", state: "Zürich" }), null);
eq("cityFor Basel: none", cityFor({ lat: 47.556, lon: 7.590, city: "Basel", state: "Basel-Stadt" }), null);
eq("cityFor a shared Geneva link (no town): by box", cityFor({ lat: 46.2, lon: 6.14 })?.id, "geneve");

console.log(bad ? `\n${bad} failed` : "\nall finder checks pass");
process.exit(bad ? 1 : 0);
