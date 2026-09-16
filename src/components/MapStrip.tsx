"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { mapsLink, ruleText, type Option } from "@/lib/finder";

/* The map is a thumbnail, not the product (direction A) — but a dot nobody can
 * ask about is just decoration. Every dot opens the street, what kind of
 * parking it is, how far it is and the rule there, with a link to Maps.
 *
 * swisstopo's grey national map: free, no key, credit "© swisstopo". Circle
 * markers only, so there are no marker images to ship or break. */
const TILES = "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg";

const KIND_WORD = { blue: "Blue zone", paid: "Paid space, free now", free: "Free, no time limit", limited: "Free with a disc" } as const;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function popupHtml(o: Option, approx?: boolean) {
  const spot = o.spot;
  const where = spot.street ? `${approx ? "Along " : ""}${escape(spot.street)}` : "Unnamed street";
  const link = approx && spot.street
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${spot.street}, Basel`)}`
    : mapsLink(spot);
  return `<div style="font-size:13px;line-height:1.4;max-width:220px">
    <div style="font-weight:700;font-size:14px">${where}</div>
    <div style="color:#56616c">${KIND_WORD[spot.kind]} · ${Math.round(spot.dist / 10) * 10} m · ${spot.spaces <= 1 ? "1 car" : `about ${spot.spaces} cars`}</div>
    <div style="margin-top:4px">${escape(ruleText(spot))}</div>
    <a href="${link}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:6px;font-weight:600;color:#1a56b0">Open in Google Maps</a>
  </div>`;
}

export default function MapStrip({ dest, chosen, others, approx }: { dest: [number, number]; chosen: Option | null; others: Option[]; approx?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  // Arrays are new on every render ("now" ticks every 30 s). Rebuild the map
  // only when a point actually moves.
  const key = JSON.stringify([dest, chosen && [chosen.spot.lat, chosen.spot.lon, chosen.spot.kind], others.map((o) => [o.spot.lat, o.spot.lon, o.spot.kind]), approx]);

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !box.current) return;
      map = L.map(box.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
      // The grey national map is drawn for print: at street zoom it is nearly
      // black. Half opacity over white keeps the streets and lets the dots lead.
      L.tileLayer(TILES, { maxZoom: 18, attribution: "© swisstopo", opacity: 0.45 }).addTo(map);
      const css = getComputedStyle(document.documentElement);
      const blue = css.getPropertyValue("--color-blue").trim() || "#1a56b0";
      const green = css.getPropertyValue("--color-green").trim() || "#146c36";
      const red = css.getPropertyValue("--color-red").trim() || "#c8261a";
      const colour = (o: Option) => (o.spot.kind === "blue" ? blue : green);

      const points: [number, number][] = [dest];
      const add = (o: Option, main: boolean) => {
        const marker = L.circleMarker([o.spot.lat, o.spot.lon], {
          radius: main ? 9 : 6,
          color: main ? "#fff" : colour(o),
          weight: 3,
          fillColor: main ? colour(o) : "#fff",
          fillOpacity: 1,
        }).addTo(map!);
        marker.bindPopup(popupHtml(o, approx));
        marker.bindTooltip(o.spot.street ?? "Unnamed street", { direction: "top" });
        points.push([o.spot.lat, o.spot.lon]);
      };
      for (const o of others) add(o, false);
      if (chosen) add(chosen, true);
      L.circleMarker(dest, { radius: 7, color: "#fff", weight: 3, fillColor: red, fillOpacity: 1 })
        .addTo(map)
        .bindTooltip("Where you are going", { direction: "top" });
      map.fitBounds(L.latLngBounds(points), { padding: [26, 26], maxZoom: 17 });
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={box} className="h-52 w-full overflow-hidden rounded-2xl bg-card" role="img" aria-label="Map of the destination and the free parking near it. Every result is also listed below as text." />;
}
