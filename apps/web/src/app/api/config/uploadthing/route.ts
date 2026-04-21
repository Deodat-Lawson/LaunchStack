/**
 * UploadThing Configuration Check API
 * Returns whether UploadThing is configured based on environment variable presence
 */

import { NextResponse } from "next/server";
import { env } from "~/env";

export async function GET() {
  const isConfigured = Boolean(env.server.UPLOADTHING_TOKEN);

  return NextResponse.json({
    configured: isConfigured,
  });
}

