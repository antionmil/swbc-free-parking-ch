/* Geneva's data mapping, attacked with the real SITG type strings and names.
 *   node qa/geneva.test.mjs */
import { genevaKind, readableName } from "../scripts/build-data.mjs";

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

console.log(bad ? `\n${bad} failed` : "\nall Geneva mapping checks pass");
process.exit(bad ? 1 : 0);
