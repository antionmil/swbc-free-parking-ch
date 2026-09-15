# Free parking in Zurich — day 13 of 26

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
pnpm test                                                        # 32 rule checks
node --experimental-strip-types --no-warnings qa/finder.test.mjs # 12 checks on the real data
node qa/contrast.mjs                                             # every text colour ≥ 4.5:1 on its surface
```

- Breaking the lunch rule on purpose (14:30 → 14:00) made `rules.test.mjs`
  fail. Restored.
- `build-data.mjs` refuses to overwrite the published file when the spot count
  falls by more than a third. Attacked by tripling yesterday's count: exit 1,
  file untouched.

## The data refresh

`.github/workflows/data.yml` runs `scripts/build-data.mjs` at 02:30 UTC, runs
both test files against the new file, and commits `public/data/zurich.json`
only if it changed. The commit redeploys on Vercel. If the city's WFS fails,
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

## Outside services

| Service | Terms, checked 2026-09-15 |
|---|---|
| swisstopo SearchServer (the destination box) | free, no key; fair use 20 requests a minute per client — the box waits 350 ms for a pause in typing, needs 3 characters, and sends two queries per pause |
| swisstopo grey national map tiles | free, no key; credit "© swisstopo" on the map |
| City of Zurich open data | CC0 |

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
