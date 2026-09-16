/* Each city's data mapping, attacked with the real type strings from its data.
 *   node qa/mapping.test.mjs */
import { genevaKind, readableName, luzernKind, lausanneKind, parseGml, lv95ToWgs84, lonLat, baselKind, baselSchedule } from "../scripts/build-data.mjs";

let bad = 0;
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad++; console.log(`${g === w ? "ok  " : "FAIL"} ${label}: ${g}${g === w ? "" : `  (want ${w})`}`); };

eq("Gratuit 60 min is the blue zone", genevaKind("Gratuit 60 min"), { kind: "blue" });
eq("Gratuit illimité has no limit", genevaKind("Gratuit illimité"), { kind: "free" });
eq("Gratuit 180 min", genevaKind("Gratuit 180 min"), { kind: "limited", maxMin: 180 });
eq("Gratuit 15 heures", genevaKind("Gratuit 15 heures"), { kind: "limited", maxMin: 900 });
eq("Gratuit jaune is reserved, dropped", genevaKind("Gratuit jaune"), null);
eq("Payant has no hours in the data, dropped", genevaKind("Payant 90 min"), null);
eq("Habitant / nuit dropped", genevaKind("Habitant / nuit"), null);
eq("empty type dropped", genevaKind(null), null);

eq("capital surname", readableName("Quai WILSON"), "Quai Wilson");
eq("hyphenated capitals", readableName("Rue Du-BOIS-MELLY"), "Rue Du-Bois-Melly");
eq("initials untouched", readableName("Avenue A.-M.-MIRANY"), "Avenue A.-M.-Mirany");
eq("accented capitals", readableName("Chemin ÉDOUARD-TAVAN"), "Chemin Édouard-Tavan");
eq("ordinary name unchanged", readableName("Rue de la Tertasse"), "Rue de la Tertasse");

// Lucerne — rows shaped like the OGD layer
const lu = (o) => ({ SUBTYPE_TEXT: "Auto-Parkplatz", PP_TYP: null, ZEIT: null, BETRIEBSKONZEPT_TEXT: null, GEBUEHR_TEXT: null, BEMERKUNG: null, ...o });
eq("Lucerne blue zone", luzernKind(lu({ PP_TYP: 2, BETRIEBSKONZEPT_TEXT: "Mo-Sa, 08:00-19:00, 60min", GEBUEHR_TEXT: "Keine" })), { kind: "blue" });
eq("Lucerne white disc 180 min, no fee", luzernKind(lu({ PP_TYP: 0, ZEIT: 180, BETRIEBSKONZEPT_TEXT: "Mo-Sa, 08.00-18.00, 180min", GEBUEHR_TEXT: "Keine" })), { kind: "limited", maxMin: 180 });
eq("Lucerne paid 07-19 daily → free outside", luzernKind(lu({ PP_TYP: 1, ZEIT: 180, BETRIEBSKONZEPT_TEXT: "Tägl. 07 - 19 / Max. Parkdauer 3 Std.", GEBUEHR_TEXT: "1.00/Std., 07.00-19.00, tägl." })), { kind: "paid", schedule: { days: "Mo-So", from: 420, to: 1140, maxMin: 180 } });
eq("Lucerne paid 24 h dropped", luzernKind(lu({ PP_TYP: 1, BETRIEBSKONZEPT_TEXT: "Tägl. 24 Std. / Max. Parkdauer 12 Std.", GEBUEHR_TEXT: "2.00/Std., 24h, tägl." })), null);
eq("Lucerne row with a remark dropped", luzernKind(lu({ PP_TYP: 2, BETRIEBSKONZEPT_TEXT: "Mo-Sa, 08:00-19:00, 60min", BEMERKUNG: "Parkverbot Mo-Fr 06:00-18:00" })), null);
eq("Lucerne disabled space dropped", luzernKind(lu({ SUBTYPE_TEXT: "IV-Parkplatz", BETRIEBSKONZEPT_TEXT: "kein Regime, keine max. Zeit", GEBUEHR_TEXT: "Keine" })), null);
eq("Lucerne event parking with no rule dropped", luzernKind(lu({ PP_TYP: 5, BETRIEBSKONZEPT_TEXT: "kein Regime, keine max. Zeit", GEBUEHR_TEXT: "Keine" })), null);

// Lausanne
eq("Lausanne blue zone (macaron)", lausanneKind("Zones bleues (macaron)", "Zone bleue"), { kind: "blue" });
eq("Lausanne white unlimited", lausanneKind("Zones blanches", "Illimité"), { kind: "free" });
eq("Lausanne white 3h", lausanneKind("Zones blanches", "3h"), { kind: "limited", maxMin: 180 });
eq("Lausanne white 30 min", lausanneKind("Zones blanches", "30 min"), { kind: "limited", maxMin: 30 });
eq("Lausanne paid dropped", lausanneKind("Zones payantes", "3h"), null);
const gml = `<gml:featureMember><ms:x><gml:boundedBy><gml:Envelope><gml:lowerCorner>1 2</gml:lowerCorner></gml:Envelope></gml:boundedBy><ms:geom><gml:Polygon><gml:posList srsDimension="2">2537026.8 1152049.2 2537036.9 1152048.2 </gml:posList></gml:Polygon></ms:geom><ms:type_txt>Zones bleues (macaron)</ms:type_txt><ms:nb_places>2</ms:nb_places></ms:x></gml:featureMember>`;
const parsed = parseGml(gml);
eq("GML: shape inside <ms:geom> is read, bounding box ignored", parsed[0].pairs, [[2537026.8, 1152049.2], [2537036.9, 1152048.2]]);
eq("GML: fields", parsed[0].props.nb_places, "2");

// Basel
eq("Basel blue zone", baselKind({ typ: "Blaue Zone" }), { kind: "blue" });
eq("Basel unmanaged space", baselKind({ typ: "Parkplätze unbewirtschaftet" }), { kind: "free" });
eq("Basel paid Mo-Sa 08-19 → free outside", baselKind({ typ: "Parkplätze gebührenpflichtig", gebpflicht: "MO-SA: 08:00-19:00" }), { kind: "paid", schedule: { days: "Mo-Sa", from: 480, to: 1140, maxMin: 0 } });
eq("Basel paid around the clock dropped", baselKind({ typ: "Parkplätze gebührenpflichtig", gebpflicht: "MO-SO: 00:00-24:00" }), null);
eq("Basel night-only fee shape dropped", baselSchedule("MO-FR: 19:00-06:00 / SA,SO: 00:00-24:00"), null);
eq("Basel time-limited without a duration dropped", baselKind({ typ: "Parkplätze mit Zeitbeschränkung", maxparkz: null }), null);
eq("Basel bikes dropped", baselKind({ typ: "Velos" }), null);

// Coordinates
const [lon, lat] = lv95ToWgs84(2600423.25, 1199521.125); // Bundesplatz 3, Bern — swisstopo gives 46.946774, 7.444192
eq("LV95 → WGS84 within 1 m of swisstopo", Math.hypot((lat - 46.946774) * 111000, (lon - 7.444192) * 76000) < 1, true);
eq("axis order [lat, lon] (Bern WFS)", lonLat([46.94, 7.47]), [7.47, 46.94]);
eq("axis order [lon, lat] (Lucerne WFS)", lonLat([8.3, 47.05]), [8.3, 47.05]);

console.log(bad ? `\n${bad} failed` : "\nall mapping checks pass");
process.exit(bad ? 1 : 0);
