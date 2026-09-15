/* WCAG contrast of every text token against the surfaces it sits on. */
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (h) => hex(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [
  ["ink", "#0f1720", ["#ffffff", "#e3ecfa"]], ["body", "#3b4652", ["#ffffff", "#e3ecfa"]], ["muted", "#56616c", ["#ffffff", "#e3ecfa", "#eef1f4"]],
  ["blue", "#1a56b0", ["#ffffff", "#e3ecfa"]], ["green", "#146c36", ["#ffffff", "#e1f3e8"]], ["red", "#c8261a", ["#ffffff"]], ["white on blue", "#ffffff", ["#1a56b0"]], ["white on ink", "#ffffff", ["#0f1720"]],
];
let bad = 0;
for (const [name, fg, bgs] of pairs) for (const bg of bgs) { const r = ratio(fg, bg); if (r < 4.5) bad++; console.log(`${r >= 4.5 ? "ok  " : "FAIL"} ${name.padEnd(14)} on ${bg}  ${r.toFixed(1)}`); }
process.exit(bad ? 1 : 0);
