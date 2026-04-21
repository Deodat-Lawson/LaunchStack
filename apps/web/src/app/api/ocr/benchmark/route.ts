/**
 * Internal benchmark endpoint — runs the full OCR/ingestion pipeline on a
 * posted file and returns the normalized document inline WITHOUT writing
 * anything to the database. Used exclusively by
 * __tests__/ocr/benchmark/run.ts to compare LaunchStack vs Onyx.
 *
 * Guard: refuses to run unless OCR_BENCHMARK_ENABLED=true so it cannot leak
 * into production as an unauthenticated extractor.
 */

import { NextResponse } from "next/server";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { routeDocument, normalizeDocument } from "@launchstack/core/ocr/processor";
import { ingestDocument } from "~/lib/ingestion/router";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: Request) {
  if (process.env.OCR_BENCHMARK_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Benchmark endpoint disabled. Set OCR_BENCHMARK_ENABLED=true to enable." },
      { status: 403 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const tmpDir = await mkdtemp(join(tmpdir(), "ocr-bench-"));
  const tmpPath = join(tmpDir, file.name);
  await writeFile(tmpPath, buf);
  const fileUrl = `file://${tmpPath}`;

  try {
    const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

    if (isPdf) {
      const decision = await routeDocument(fileUrl);
      const result = await normalizeDocument(fileUrl, decision);
      return NextResponse.json({
        provider: decision.selectedProvider,
        pages: result.pages,
      });
    }

    const doc = await ingestDocument(buf, { filename: file.name, mimeType: file.type });
    return NextResponse.json({
      provider: doc.metadata.provider,
      pages: doc.pages,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
