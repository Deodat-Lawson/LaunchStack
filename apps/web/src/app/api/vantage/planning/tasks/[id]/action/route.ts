import { actVantageV2Task } from "~/server/vantage/v2/service";
import { z } from "zod";
import { NextResponse } from "next/server";
import { vantageV2Actor, vantageV2Error } from "~/server/vantage/v2/access";
export async function POST(r: Request, { params }: { params: Promise<{ id: string }> }) {
    const a = await vantageV2Actor(true);
    if (!a.ok) return a.response;
    try {
        return NextResponse.json(
            await actVantageV2Task(
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
