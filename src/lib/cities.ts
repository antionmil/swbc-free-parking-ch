/* The cities with official street-parking data good enough to give an
 * instruction. Checked on day 13 — see ../../prep/cities.md for the ones that
 * are not here and why (Basel: the dataset with blue zones is restricted,
 * "beschränkt öffentlich", behind a special login; Winterthur, St. Gallen,
 * Lugano: no usable space-level dataset found; OpenStreetMap: almost no parking
 * rules mapped anywhere in Switzerland). */

export type City = {
  id: "zurich" | "geneve" | "bern" | "luzern" | "lausanne";
  name: string;
  file: string;
  /** a rough box, used when the search result carries no town or canton */
  box: { s: number; n: number; w: number; e: number };
  /** is a search result inside the area this city's data covers? */
  covers: (d: { lat: number; lon: number; city?: string; state?: string }) => boolean;
  credit: string;
};

const inBox = (b: City["box"], lat: number, lon: number) => lat > b.s && lat < b.n && lon > b.w && lon < b.e;

/* Names come back in the search's language — the page asks in German, so
   "Genf", "Luzern", "Waadt". Every form a visitor or a search result may
   use is accepted: the first Geneva check only knew "Genève" and turned
   Plainpalais away. */
const byCity = (names: RegExp, box: City["box"]) => (d: { lat: number; lon: number; city?: string }) =>
  d.city ? names.test(d.city) : inBox(box, d.lat, d.lon);

const ZURICH_BOX = { s: 47.32, n: 47.44, w: 8.44, e: 8.63 };
const GENEVE_BOX = { s: 46.12, n: 46.37, w: 5.95, e: 6.32 };
const BERN_BOX = { s: 46.91, n: 46.99, w: 7.35, e: 7.5 };
const LUZERN_BOX = { s: 47.0, n: 47.09, w: 8.22, e: 8.38 };
const LAUSANNE_BOX = { s: 46.49, n: 46.61, w: 6.56, e: 6.73 };

export const CITIES: City[] = [
  {
    id: "zurich", name: "Zurich", file: "/data/zurich.json", box: ZURICH_BOX,
    // The city only: Wallisellen's Glatt centre is inside the box and has no City of Zurich data.
    covers: byCity(/^(Zürich|Zurich|Zurigo)$/i, ZURICH_BOX),
    credit: "City of Zurich parking data (CC0)",
  },
  {
    id: "geneve", name: "Geneva", file: "/data/geneve.json", box: GENEVE_BOX,
    // The SITG layer covers the whole canton: Carouge, Lancy, Vernier too.
    covers: (d) => (d.state ? /^(Genève|Geneve|Genf|Geneva|Ginevra)$/i.test(d.state) : inBox(GENEVE_BOX, d.lat, d.lon)),
    credit: "Canton of Geneva parking data (source: SITG)",
  },
  {
    id: "bern", name: "Bern", file: "/data/bern.json", box: BERN_BOX,
    covers: byCity(/^(Bern|Berne|Berna)$/i, BERN_BOX),
    credit: "City of Bern parking data (blue zone), street names © OpenStreetMap contributors",
  },
  {
    id: "lausanne", name: "Lausanne", file: "/data/lausanne.json", box: LAUSANNE_BOX,
    covers: byCity(/^(Lausanne|Losanna)$/i, LAUSANNE_BOX),
    credit: "Ville de Lausanne parking data, street names © OpenStreetMap contributors",
  },
  {
    id: "luzern", name: "Lucerne", file: "/data/luzern.json", box: LUZERN_BOX,
    covers: byCity(/^(Luzern|Lucerne|Lucerna)$/i, LUZERN_BOX),
    credit: "City of Lucerne parking data, street names © OpenStreetMap contributors",
  },
];

export const cityFor = (d: { lat: number; lon: number; city?: string; state?: string }) => CITIES.find((c) => c.covers(d)) ?? null;

/** "Zurich, Geneva, Bern, Lausanne and Lucerne" */
export const cityList = (last = "and") => {
  const names = CITIES.map((c) => c.name);
  return `${names.slice(0, -1).join(", ")} ${last} ${names.at(-1)}`;
};
