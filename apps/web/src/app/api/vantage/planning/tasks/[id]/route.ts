import { vantageV2Repository } from "~/server/vantage/v2/service";
import { z } from "zod";
import { NextResponse } from "next/server";
import { vantageV2Actor, vantageV2Error } from "~/server/vantage/v2/access";
export async function PATCH(r: Request, { params }: { params: Promise<{ id: string }> }) {
    const a = await vantageV2Actor(true);
    if (!a.ok) return a.response;
    try {
        return NextResponse.json(
            await vantageV2Repository.patch(
                a.actor,
                z
                    .string()
                    .uuid()
                    .parse((await params).id),
                await r.json()
            )
        );
    } catch (e) {
        return vantageV2Error(e);
    }
}
export async function DELETE(r: Request, { params }: { params: Promise<{ id: string }> }) {
    const a = await vantageV2Actor(true);
    if (!a.ok) return a.response;
    try {
        const d = z
            .object({ expectedVersion: z.number().int().positive() })
            .strict()
            .parse(await r.json());
        return NextResponse.json(
            await vantageV2Repository.remove(
                a.actor,
                z
                    .string()
                    .uuid()
                    .parse((await params).id),
                d.expectedVersion
            )
        );
    } catch (e) {
        return vantageV2Error(e);
    }
}
