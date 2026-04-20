import { NextResponse } from "next/server";

export const revalidate = 3600;

export async function GET() {
  const providers = {
    azure: !!process.env.AZURE_DOC_INTELLIGENCE_KEY && !!process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT,
    datalab: !!process.env.DATALAB_API_KEY,
    landingAI: !!process.env.LANDING_AI_API_KEY,
  };

  return NextResponse.json(providers);
}
