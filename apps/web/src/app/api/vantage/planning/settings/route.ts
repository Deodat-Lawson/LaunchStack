import { getVantageV2Settings, putVantageV2Settings } from "~/server/vantage/v2/settings";
import { NextResponse } from "next/server";
import { vantageV2Actor, vantageV2Error } from "~/server/vantage/v2/access";
export async function GET() {
    const a = await vantageV2Actor();
    if (!a.ok) return a.response;
    try {
        return NextResponse.json(await getVantageV2Settings(a.actor));
    } catch (e) {
        return vantageV2Error(e);
    }
}
export async function PUT(r: Request) {
    const a = await vantageV2Actor(true);
    if (!a.ok) return a.response;
    try {
        return NextResponse.json(await putVantageV2Settings(a.actor, await r.json()));
    } catch (e) {
        return vantageV2Error(e);
    }
}
