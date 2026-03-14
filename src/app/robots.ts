import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://launchstack.app';

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: ['/api/', '/employer/', '/employee/', '/admin/'],
            },
        ],
        sitemap: `${SITE_URL}/sitemap.xml`,
    };
}
