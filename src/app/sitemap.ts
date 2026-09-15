import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://freeparking.onedaybuilt.com/", changeFrequency: "daily" }];
}
