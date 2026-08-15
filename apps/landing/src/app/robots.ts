import type { MetadataRoute } from 'next';
import { SITE_URL } from '~/config/site';

// This origin is the public site and is entirely indexable. The /api/,
// /employer/, /employee/ and /admin/ disallows that used to live here moved
// with the app to app.launchstack.app, whose own robots.ts disallows
// everything — so none of those paths exist on this host any more.
export default function robots(): MetadataRoute.Robots {
    return {
        rules: [{ userAgent: '*', allow: '/' }],
        sitemap: `${SITE_URL}/sitemap.xml`,
    };
}
