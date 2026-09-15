"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Option } from "@/lib/finder";

/* The map is a thumbnail, not the product (direction A). swisstopo's grey
 * national map: free, no key, credit "© swisstopo". Circle markers only, so
 * there are no marker images to ship or break. */
const TILES = "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg";

export default function MapStrip({ dest, chosen, others }: { dest: [number, number]; chosen: Option | null; others: Option[] }) {
  const box = useRef<HTMLDivElement>(null);
  // Arrays are new on every render ("now" ticks every 30 s). Rebuild the map
  // only when a point actually moves.
  const key = JSON.stringify([dest, chosen && [chosen.spot.lat, chosen.spot.lon, chosen.spot.kind], others.map((o) => [o.spot.lat, o.spot.lon, o.spot.kind])]);

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !box.current) return;
      map = L.map(box.current, { zoomControl: false, scrollWheelZoom: false, attributionControl: true });
      // The grey national map is drawn for print: at street zoom it is nearly
      // black. Half opacity over white keeps the streets and lets the dots lead.
      L.tileLayer(TILES, { maxZoom: 18, attribution: "© swisstopo", opacity: 0.45 }).addTo(map);
      const css = getComputedStyle(document.documentElement);
      const blue = css.getPropertyValue("--color-blue").trim() || "#1a56b0";
      const green = css.getPropertyValue("--color-green").trim() || "#146c36";
      const red = css.getPropertyValue("--color-red").trim() || "#c8261a";
      const colour = (o: Option) => (o.spot.kind === "blue" ? blue : green);

      const points: [number, number][] = [dest];
      for (const o of others) {
        L.circleMarker([o.spot.lat, o.spot.lon], { radius: 6, color: colour(o), weight: 3, fillColor: "#fff", fillOpacity: 1 }).addTo(map);
        points.push([o.spot.lat, o.spot.lon]);
      }
      if (chosen) {
        L.circleMarker([chosen.spot.lat, chosen.spot.lon], { radius: 9, color: "#fff", weight: 3, fillColor: colour(chosen), fillOpacity: 1 }).addTo(map);
        points.push([chosen.spot.lat, chosen.spot.lon]);
      }
      L.circleMarker(dest, { radius: 7, color: "#fff", weight: 3, fillColor: red, fillOpacity: 1 }).addTo(map);
      map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 17 });
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={box} className="h-40 w-full overflow-hidden rounded-2xl bg-card" role="img" aria-label="Map of the destination and the free parking near it" />;
}
