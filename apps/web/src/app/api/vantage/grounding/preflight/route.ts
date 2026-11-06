import { groundingRoute } from "../_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
    return groundingRoute(request, service => service.preflight());
}
