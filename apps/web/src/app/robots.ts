import type { MetadataRoute } from "next";

// The product origin is entirely private: every route below / sits behind
// Clerk, and / itself redirects to /signin. Nothing here belongs in an index.
// Public SEO — sitemap included — lives in apps/landing.
//
// No `sitemap` key: this origin serves no sitemap.xml, and pointing at one
// that 404s is worse than omitting the directive.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
