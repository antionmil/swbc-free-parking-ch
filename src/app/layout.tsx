import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://freeparking.onedaybuilt.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Free parking in Zurich",
  description: "Type where you're going. See where you can park for free right now, what to set on your parking disc, and when it gets free later.",
  openGraph: {
    title: "Free parking in Zurich",
    description: "Where to park for free right now, what to set on your disc, and when to move the car.",
    url: SITE,
    siteName: "Free parking in Zurich",
    images: [{ url: "/api/og", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", images: ["/api/og"] },
};

export const viewport: Viewport = { themeColor: "#eef1f4" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
