import { vantageV2Repository, createVantageV2Plan } from "~/server/vantage/v2/service";
import { z } from "zod";
import { NextResponse } from "next/server";
import { vantageV2Actor, vantageV2Error } from "~/server/vantage/v2/access";
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
    const a = await vantageV2Actor();
    if (!a.ok) return a.response;
    try {
        return NextResponse.json(
            await vantageV2Repository.get(
                a.actor,
                z
                    .string()
                    .uuid()
                    .parse((await params).id)
            )
        );
    } catch (e) {
        return vantageV2Error(e);
    }
}
export async function POST(_r: Request, { params }: { params: Promise<{ id: string }> }) {
    const a = await vantageV2Actor(true);
    if (!a.ok) return a.response;
    try {
        return NextResponse.json(
            await createVantageV2Plan(
                a.actor,
                z
                    .string()
                    .uuid()
                    .parse((await params).id)
            )
        );
    } catch (e) {
        return vantageV2Error(e);
    }
}
