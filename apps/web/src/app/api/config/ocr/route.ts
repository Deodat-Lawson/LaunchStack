import { NextResponse } from "next/server";

import { ocrOverview } from "~/server/ocr-availability";

// Docling's answer comes from a live probe of the document converter, so this
// is computed per request (the probe itself is cached for seconds), never at
// build time.
export const dynamic = "force-dynamic";

/** The OCR providers this server can run, as the upload bootstrap reports them, plus their order. */
export async function GET() {
    const { availableProviders, order } = await ocrOverview();
    return NextResponse.json({ ...availableProviders, order });
}
