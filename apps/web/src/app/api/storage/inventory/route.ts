import "server-only";

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import type { ObjectRef } from "@launchstack/core/storage";
import {
  listObjectsPrivileged,
  type PrivilegedListObjectsErrorKind,
} from "~/server/storage/inventory";

const ADAPTERS = new Set<ObjectRef["adapter"]>([
  "s3",
  "vercel-blob",
  "database",
  "uploadthing",
]);

function isAdapter(value: string | null): value is ObjectRef["adapter"] {
  return Boolean(value && ADAPTERS.has(value as ObjectRef["adapter"]));
}

function toStatusCode(kind: PrivilegedListObjectsErrorKind): number {
  switch (kind) {
    case "invalid_request":
      return 400;
    case "blocked":
      return 409;
    case "unavailable":
      return 503;
    case "retryable":
      return 503;
  }
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const adapterRaw = url.searchParams.get("adapter");
  const storageLocationId = url.searchParams.get("storageLocationId")?.trim() ?? "";

  if (!isAdapter(adapterRaw)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          kind: "invalid_request",
          code: "invalid_adapter",
          message: "Query param adapter must be one of: s3, vercel-blob, database, uploadthing.",
        },
      },
      { status: 400 },
    );
  }

  if (storageLocationId.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          kind: "invalid_request",
          code: "missing_storage_location_id",
          message: "Query param storageLocationId is required.",
        },
      },
      { status: 400 },
    );
  }

  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw == null ? undefined : Number.parseInt(limitRaw, 10);

  const result = await listObjectsPrivileged({
    adapter: adapterRaw,
    storageLocationId,
    prefix: url.searchParams.get("prefix") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }

  return NextResponse.json(result, { status: toStatusCode(result.error.kind) });
}
