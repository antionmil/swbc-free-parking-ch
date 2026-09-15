/* The cities with official street-parking data good enough to give an
 * instruction. Checked on day 13 — see ../../prep/cities.md for the ones that
 * are not here and why (Basel: no positions in its open data; Bern, Lausanne,
 * Winterthur, Lucerne, St. Gallen, Lugano: no space-level dataset found;
 * OpenStreetMap: almost no parking rules mapped anywhere in Switzerland). */

export type City = {
  id: "zurich" | "geneve";
  name: string;
  file: string;
  /** a rough box, used when the search result carries no town or canton */
  box: { s: number; n: number; w: number; e: number };
  /** is a search result inside the area this city's data covers? */
  covers: (d: { lat: number; lon: number; city?: string; state?: string }) => boolean;
  credit: string;
};

const inBox = (b: City["box"], lat: number, lon: number) => lat > b.s && lat < b.n && lon > b.w && lon < b.e;

const ZURICH_BOX = { s: 47.32, n: 47.44, w: 8.44, e: 8.63 };
// The canton of Geneva. The box also holds French towns, but search results are
// limited to Switzerland, and a spot is only offered within 1 km of the place.
const GENEVE_BOX = { s: 46.12, n: 46.37, w: 5.95, e: 6.32 };

export const CITIES: City[] = [
  {
    id: "zurich",
    name: "Zurich",
    file: "/data/zurich.json",
    box: ZURICH_BOX,
    // The city of Zurich only: Wallisellen's Glatt centre is inside the box
    // and has no City of Zurich data.
    covers: (d) => (d.city ? /^(Zürich|Zurich|Zurigo)$/i.test(d.city) : inBox(ZURICH_BOX, d.lat, d.lon)),
    credit: "City of Zurich parking data (CC0)",
  },
  {
    id: "geneve",
    name: "Geneva",
    file: "/data/geneve.json",
    box: GENEVE_BOX,
    // The SITG layer covers the whole canton: Carouge, Lancy, Vernier too.
    // Names come back in the search's language — the page asks in German, so
    // "Genf": the first version only accepted "Genève" and turned Plainpalais
    // away as "not covered".
    covers: (d) => (d.state ? /^(Genève|Geneve|Genf|Geneva|Ginevra)$/i.test(d.state) : inBox(GENEVE_BOX, d.lat, d.lon)),
    credit: "Canton of Geneva parking data (source: SITG)",
  },
];

export const cityFor = (d: { lat: number; lon: number; city?: string; state?: string }) => CITIES.find((c) => c.covers(d)) ?? null;
