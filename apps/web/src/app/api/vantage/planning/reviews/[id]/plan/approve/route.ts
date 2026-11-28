import { approveVantageV2Plan } from "~/server/vantage/v2/service";
import { z } from "zod";
import { NextResponse } from "next/server";
import { vantageV2Actor, vantageV2Error } from "~/server/vantage/v2/access";
export async function POST(r: Request, { params }: { params: Promise<{ id: string }> }) {
    const a = await vantageV2Actor(true);
    if (!a.ok) return a.response;
    try {
        const data = z
            .object({
                version: z.number().int().positive(),
                hash: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict()
            .parse(await r.json());
        return NextResponse.json(
            await approveVantageV2Plan(
                a.actor,
                z
                    .string()
                    .uuid()
                    .parse((await params).id),
                data.version,
                data.hash
            )
        );
    } catch (e) {
        return vantageV2Error(e);
    }
}
