import { ImageResponse } from "next/og";

export const runtime = "nodejs";

/**
 * THE FONT TRAP.
 *
 * ImageResponse needs real font bytes - it cannot use a CSS font-family, and
 * a missing font silently falls back to a default that looks nothing like the
 * site. Budget an hour for this once, here, and never again for 26 builds.
 *
 * Fetch the TTF once per lambda and memoise it. Google's CSS endpoint returns
 * a stylesheet, not a font, so we parse the src URL out of it first.
 */
let fontCache: ArrayBuffer | null = null;

async function displayFont(): Promise<ArrayBuffer | null> {
  if (fontCache) return fontCache;
  try {
    const cssRes = await fetch(
      "https://fonts.googleapis.com/css2?family=Archivo:wght@700&display=swap",
      // A modern UA gets woff2, which ImageResponse cannot read. Pretend to be
      // old so Google serves a TTF.
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; SWBC/1.0)" } },
    );
    const css = await cssRes.text();
    const url = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (!url) return null;
    fontCache = await (await fetch(url)).arrayBuffer();
    return fontCache;
  } catch {
    return null; // never let a font failure take down the image
  }
}

/* One card for the site. The answer depends on the place and the minute, so
   a per-link card would be stale by the time anyone saw it. */
export async function GET() {
  const font = await displayFont();
  return new ImageResponse(
    (
      <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#eef1f4", color: "#0f1720", padding: "72px", fontFamily: font ? "Display" : "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", width: 72, height: 72, borderRadius: 14, background: "#1a56b0", color: "#fff", fontSize: 52, alignItems: "center", justifyContent: "center" }}>P</div>
          <div style={{ display: "flex", fontSize: 28, color: "#56616c", letterSpacing: 3 }}>FREE PARKING · ZURICH · GENEVA · BERN · LAUSANNE · BASEL · LUCERNE</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 76, lineHeight: 1.05 }}>Park on Steinwiesstrasse.</div>
          <div style={{ display: "flex", gap: 18 }}>
            <div style={{ display: "flex", flexDirection: "column", background: "#fff", borderRadius: 16, padding: "16px 24px" }}>
              <div style={{ display: "flex", fontSize: 24, color: "#56616c" }}>Set your disc to</div>
              <div style={{ display: "flex", fontSize: 54 }}>14:30</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", background: "#fff", borderRadius: 16, padding: "16px 24px" }}>
              <div style={{ display: "flex", fontSize: 24, color: "#56616c" }}>Move the car by</div>
              <div style={{ display: "flex", fontSize: 54 }}>15:30</div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#3b4652" }}>
          <div style={{ display: "flex" }}>Where you can park for free, right now.</div>
          <div style={{ display: "flex", color: "#1a56b0" }}>freeparking.onedaybuilt.com</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: font ? [{ name: "Display", data: font, style: "normal", weight: 700 }] : [],
      headers: { "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    },
  );
}
