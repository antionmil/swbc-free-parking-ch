# Free parking in Zurich and Geneva — day 13 of 26

Type where you're going. See where you can park for free at that time, what to
set on your parking disc, when to move the car — and, later in the day, when
the limits stop.

Live at **freeparking.onedaybuilt.com**.

## The one decision everything follows from

**An instruction, not a map.** Parking apps give you a map to study at a red
light. This gives one sentence — *Park on Steinwiesstrasse. Set your disc to
14:30. Move the car by 15:30.* — with the map as a thumbnail and the next
streets underneath in case it's full. Below that, a timeline of when it gets
free later: blue zones need no disc from 19:00, most meters stop at 20:00,
Sunday has no limit.

**Every result copies straight into Google Maps.** People plan the drive in
Maps, so each spot has "Copy for Google Maps" and "Open in Google Maps". The
copy is the spot's coordinates (`47.37067, 8.54850`), not the street name: the
city data has no house numbers, and a street name alone lands in the middle of
the street — on a long one, half a kilometre from the spaces. The link uses
the documented [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)
form (`/maps/search/?api=1&query=lat%2Clng`), which needs no key and opens the
Maps app on a phone.

**The field takes a place or an address.** A pasted address works as it is —
"Kunsthaus Zürich, Heimplatz 1, 8001 Zürich" resolves to Heimplatz 1 — and the
phone keyboard's search key picks the first match. The page then lists up to
seven free spots within 1 km, nearest first, one per street.

No account, no app, no database, no AI. The page is static; all the work is
done in the browser against one 141 KB file rebuilt every night.

## Cities: Zurich and Geneva, and why not the others yet

The page picks the city from the destination — no city picker. A city is added
only when its official open data says where every space is and what kind it
is. Checked on day 13:

| City | Street-parking data | Verdict |
|---|---|---|
| **Zurich** | City of Zurich DAV layers, daily, CC0 | live |
| **Geneva** (whole canton) | SITG `OTC_STATIONNEMENT_V_PUBLIQUE`, every stretch with type and places; free to reuse with the source named, commercial use needs permission | live |
| Basel | `Parkflächen` on data.bs.ch is current, but 0 of 7,815 records have a position; the full geodata is ordered by email from the canton's shop | not yet — needs that order |
| Bern | only permit-card zones published, no spaces | no data |
| Lausanne | a 2016 dataset; opendata.swiss refused automated requests, not inspected | unverified |
| Winterthur, Lucerne, St. Gallen, Lugano | no space-level dataset found | no data |
| OpenStreetMap, any city | Overpass count on day 13: 0–4 streets per city with any parking rule mapped | cannot say where parking is free |

## Geneva

| SITG type | Places | What the page does |
|---|---|---|
| Gratuit 60 min | 27,198 | blue zone — the national disc rules; Geneva's [Fondation des Parkings](https://www.geneve-parking.ch/fr/faq/voie-publique/zones-bleues-et-disque-de-stationnement) states the same hours, lunch rule and night rule |
| Gratuit illimité | 2,210 | **free, no time limit** — no disc, no move-by time |
| Gratuit 30/120/180/240 min, 8/15 heures | 5,820 | free with a disc for that long. The hours the limit applies are not in the data, so it counts as always on: the answer can only be stricter than the sign |
| Payant … | ~5,200 | dropped — no paid hours in the data |
| Gratuit jaune, Habitant / nuit, Police, 2 roues, Vélos, … | — | dropped |

**The street names in the Geneva data are a third wrong.** 4,333 of 12,731
stretches are named "Route de Foliaz" — a road in Collonge-Bellerive — while
lying all over the canton. The first build told someone at Rue du Rhône to
"Park on Route de Foliaz". Every name is now checked against the canton's
official street graph (`GMO_GRAPHE_VOIES_OFFICIELLES`): placeholders and empty
names take the nearest official street within 45 m (1,949 on day 13), and any
other name more than 300 m from its own street is replaced the same way (13).
Official names write surnames in capitals ("Quai WILSON"); the page writes
"Quai Wilson", as Google Maps does.

SITG rows carry no date, so the page says "fetched" with the build date, not
"from".

**Also caught in the browser, not by the unit tests:** the place search asks
for German names, so Geneva comes back as "Genf". The first coverage check
only accepted "Genève" and sent Plainpalais to "not covered". Every language
form is accepted now, and `qa/finder.test.mjs` checks "Genf".

## Why Zurich first

It has the strongest hook and, checked on day 13, the best data. The dataset
most people find stops at the end of 2021; the one used here is updated
**daily** and is CC0. Full comparison with Basel, Geneva, Lausanne and Bern in
`../prep/cities.md`.

| Layer (WFS `oeffentlich_zugaengliche_Parkplaetze_DAV`) | Used for |
|---|---|
| `oeff_strassenparkierung_dav_p` — 13,272 spaces as points | blue zone spaces; paid spaces |
| `oeff_strassenparkierung_dav_l` — parallel stretches with length | blue zone stretches (length ÷ 5.5 m = cars) |
| `oeff_strassenparkierung_spuzpu` — 1,397 meters with tariff text | when each paid space is charged |
| `Strassennamenverzeichnis` `sv_str_lin` | the street name in the instruction |

## The rules, and where each one comes from

All in `src/lib/rules.ts`, with sources in `../prep/rules.md`:

| Rule | Source |
|---|---|
| Blue zone limited Monday–Saturday 08:00–19:00 | SSV Art. 48 |
| Sundays and public holidays unlimited unless a sign says so | SSV Art. 48 |
| Disc set to the next hour or half-hour mark; stay 1 hour | SSV Art. 48, Stadt Winterthur |
| Arrive 11:30–13:29 → stay until 14:30 | Stadt Winterthur |
| 19:00–07:59 no disc if you leave before 08:00 | Stadt Winterthur |
| Paid spaces charged by their meter's hours, e.g. `HOCH 2h Mo-Sa 09:00-20:00` | the city's own meter data |

**Where the law or the data is unclear, the code picks the answer that sends
nobody to a ticket** — an earlier "move by", never a later one:

- On an exact half-hour the disc uses that mark, not the next one.
- Public holidays are treated as working days (the page says so).
- "Arrive after 18:00, stay until 09:00" is on blogs but in no official source,
  so it is not used.
- A paid space outside meter hours says **"no fee"**, never "no limit": no
  source was found on whether the time limit still applies then. The page says
  "check the sign".

## What is left out, on purpose

- **White spaces with a disc** (`art = Parkscheibe`, 610): the data has no
  maximum duration for them, so there is no instruction to give.
- **2,310 paid spaces** whose meters within 120 m disagree on hours, or carry a
  special tariff ("Zoo ganze Woche", "Kreis 5 Spezial" — Zurich-West is charged
  Thursday to Sunday around the clock). Guessing would send people to tickets.
- **Occupancy.** No city publishes which spaces are empty. The page says it
  shows where free parking is *allowed*, and that the street sign always wins.

## Tests — each attacked, not just run

```
pnpm test    # 32 rule checks, 28 finder checks on both real data files, 13 Geneva mapping checks
node qa/contrast.mjs                                             # every text colour ≥ 4.5:1 on its surface
```

- Breaking the lunch rule on purpose (14:30 → 14:00) made `rules.test.mjs`
  fail. Restored.
- `build-data.mjs` refuses to overwrite the published file when the spot count
  falls by more than a third. Attacked by tripling yesterday's count: exit 1,
  file untouched.

## The data refresh

`.github/workflows/data.yml` runs `scripts/build-data.mjs` at 02:30 UTC for
both cities, runs every test file against the new files, and commits
`public/data/` only if it changed. Geneva's file carries its fetch date, so it
changes — and redeploys — once a day. A city whose server fails keeps its old
file and fails the job; the other city still updates. The commit redeploys on Vercel. If the city's WFS fails,
the job fails and the site keeps serving yesterday's file with yesterday's
date on it.

## Found by the live audit, after the copy buttons shipped

- **React hydration error #418 on every load.** The page is prerendered once,
  and the build baked its own clock into the time chip ("Now · Tue 20:15"),
  which never matched the visitor's. The clock now starts in the browser; the
  chip says "Now" until it does. Only visible on the production build — the
  dev server did not show it.
- **"Bundesplatz Bern" silently became "Bernegg"**, a street in Zurich. The
  search added "Zürich" to every query and hid every result outside the city,
  so a Bern address was swapped for a Zurich lookalike with no warning. It now
  runs the text as typed alongside the Zurich query; when the text as typed
  means a place outside Zurich, that place comes first, marked "outside
  Zurich", and picking it says "Only Zurich so far".

## Search, rebuilt after a real test on a phone

Typing "Apple basel" offered the city of Basel and "Heidi-Abel-Weg", never the
Apple Store. swisstopo's SearchServer knows addresses, place names and stops —
no shops, no businesses. The field now asks two sources:

- **Photon** (photon.komoot.io, OpenStreetMap data) for places people name:
  "Apple Store" → Rennweg 43, "Migros Oerlikon" → Baumackerstrasse 35. Limited
  to Switzerland, biased to Zurich, with bus platforms, tram stops, fire alarm
  panels and the like filtered out.
- **swisstopo**, only when the text has a number, for exact Swiss addresses. A
  number with no town named ("Bahnhofstrasse 1") is also asked as a Zurich
  address and listed first — as typed, it came back as Goldau, Eschenz, Elgg.

"Outside Zurich" is decided by the town name the search returns, not by a
rectangle: the Glatt centre in Wallisellen sits inside the rectangle and has
no City of Zurich parking data.

## Outside services

| Service | Terms, checked 2026-09-15 |
|---|---|
| swisstopo SearchServer (the destination box) | free, no key; fair use 20 requests a minute per client — the box waits 350 ms for a pause in typing, needs 3 characters, and sends two queries per pause |
| swisstopo grey national map tiles | free, no key; credit "© swisstopo" on the map |
| Photon (place search) | free, no key; "please be fair — extensive usage will be throttled", no availability guarantee; OpenStreetMap data, credited on the page |
| City of Zurich open data | CC0 |
| SITG (Canton of Geneva) | free reuse with the source named; commercial use needs prior permission — this site is free, and credits "source: SITG" |

The browser calls swisstopo directly; this site has no server code except the
share image at `/api/og`.

## Timing notes

- Walking time is 1.3 × the straight distance at 80 m a minute, shown as
  "about".
- Times are Zurich wall-clock minutes; on the two clock-change nights a time can
  be an hour off. No rule changes between 02:00 and 03:00.

## Running it

```
pnpm install
pnpm data      # fetch and build public/data/zurich.json
pnpm dev
```
