import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getCompanyIdForUser,
  searchWikiLinkCandidates,
} from "~/server/notes/wiki-links";

export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const title = searchParams.get("title") ?? "";
    if (!title.trim()) {
      return NextResponse.json({ candidates: [] }, { status: 200 });
    }

    const companyId = await getCompanyIdForUser(userId);
    const candidates = await searchWikiLinkCandidates(title, {
      companyId,
      userId,
      limit: 10,
    });

    return NextResponse.json({ candidates }, { status: 200 });
  } catch (err) {
    console.error("[/api/notes/resolve] failed:", err);
    return NextResponse.json({ error: "Resolve failed" }, { status: 500 });
  }
}
