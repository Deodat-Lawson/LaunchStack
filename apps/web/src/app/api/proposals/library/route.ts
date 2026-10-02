// GET  /api/proposals/library — every saved answer
// POST /api/proposals/library — { question, answer, tags? }
import type { NextRequest } from "next/server";
import { z } from "zod";

import { loadLibrary, newLibraryItem } from "~/server/proposals/service";

import { error, proposalsContext, handleProposalsError, json, readBody } from "../_http";

const Schema = z.object({
    question: z.string().min(1).max(1_000),
    answer: z.string().min(1).max(100_000),
    tags: z.array(z.string().min(1).max(40)).max(10).optional(),
});

export async function GET() {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        return json({ items: await loadLibrary(auth.ctx) });
    } catch (err) {
        return handleProposalsError("GET library", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const parsed = Schema.safeParse(await readBody(request));
        if (!parsed.success) return error("A saved answer needs a question and an answer", 400);
        return json({ item: await newLibraryItem(auth.ctx, parsed.data) }, 201);
    } catch (err) {
        return handleProposalsError("POST library", err);
    }
}
