import type { MetadataRoute } from "next";
import { SITE_URL } from "~/config/site";

// Only routes this origin actually serves. Two entries were dropped in the
// apps/landing split:
//   /about  — the route has never existed in any app; it 404'd.
//   /signup — it lives on app.launchstack.app now, and a sitemap entry
//             pointing at a different host is invalid, so search engines
//             ignore or flag it rather than following it.
export default function sitemap(): MetadataRoute.Sitemap {
    return [
        { url: SITE_URL, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
        {
            url: `${SITE_URL}/pricing`,
            lastModified: new Date(),
            changeFrequency: "weekly",
            priority: 0.9,
        },
        {
            url: `${SITE_URL}/deployment`,
            lastModified: new Date(),
            changeFrequency: "weekly",
            priority: 0.8,
        },
        {
            url: `${SITE_URL}/contact`,
            lastModified: new Date(),
            changeFrequency: "monthly",
            priority: 0.5,
        },
    ];
}
