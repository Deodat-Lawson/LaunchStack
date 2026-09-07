/**
 * The Launchstack mark for OG cards.
 *
 * `opengraph-image.tsx` routes render through satori, which is neither React
 * DOM nor a browser: it does not run `LaunchstackMark` (hooks, `oklch()`), so
 * the mark has to be handed over as a flat SVG. Satori inlines an
 * `image/svg+xml` data URI into its output, which resvg then rasterizes, so
 * the gradient and the rotated tile survive the trip.
 *
 * The geometry below is the same as `public/icon.svg` and `LaunchstackMark`.
 * `apps/web/__tests__/brand/logo-consistency.test.ts` fails if it drifts.
 */

// sRGB equivalents of the component's OKLCH stops — satori doesn't parse oklch().
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="ls-mark-fill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7e4ed7"/>
      <stop offset="55%" stop-color="#4e1ca8"/>
      <stop offset="100%" stop-color="#1f0658"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="56" height="56" rx="10" transform="rotate(-6 32 32)" fill="url(#ls-mark-fill)"/>
  <path d="M18 17 L18 47 L32 47" stroke="#ffffff" stroke-width="5" stroke-linecap="square" fill="none"/>
  <path d="M46 18 L30 18 L30 32 L46 32 L46 46 L30 46" stroke="#ffffff" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter" fill="none"/>
  <circle cx="18" cy="54" r="2.4" fill="#ffffff" opacity="0.85"/>
</svg>`;

/** ASCII-only markup, so `btoa` is safe on the edge runtime. */
export const MARK_DATA_URI = `data:image/svg+xml;base64,${btoa(MARK_SVG)}`;

/** The mark at `size` px square, ready to drop into an `ImageResponse` tree. */
export function OgMark({ size }: { size: number }) {
    // eslint-disable-next-line @next/next/no-img-element -- satori has no next/image
    return <img src={MARK_DATA_URI} width={size} height={size} alt="" />;
}
