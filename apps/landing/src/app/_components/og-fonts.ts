/**
 * Inter for the 1200×630 social cards. next/og (satori) cannot read the
 * next/font files, and without `fonts` it renders its bundled Noto Sans
 * Regular — no bold, and not the product typeface. The cards fetch Inter's
 * static TTF instances from Google Fonts (where next/font downloads it
 * from at build). Any failure yields `undefined` and the card still renders
 * in the bundled face; a failure is not memoised, so the next request retries.
 */
type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" };

const CSS_URL = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700";
const FACE = /font-weight:\s*(\d+);\s*src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/g;

async function load(): Promise<OgFont[] | undefined> {
    try {
        const res = await fetch(CSS_URL, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return undefined;
        const faces = [...(await res.text()).matchAll(FACE)];
        if (faces.length === 0) return undefined;
        return await Promise.all(
            faces.map(async ([, weight, url]) => {
                const file = await fetch(url!, { signal: AbortSignal.timeout(4000) });
                if (!file.ok) throw new Error(`Inter ${weight}: HTTP ${file.status}`);
                return {
                    name: "Inter",
                    data: await file.arrayBuffer(),
                    weight: Number(weight) as OgFont["weight"],
                    style: "normal" as const,
                };
            })
        );
    } catch {
        return undefined;
    }
}

let cached: Promise<OgFont[] | undefined> | undefined;

export function ogFonts(): Promise<OgFont[] | undefined> {
    cached ??= load().then(fonts => {
        if (!fonts) cached = undefined;
        return fonts;
    });
    return cached;
}
