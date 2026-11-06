import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import { groundingRoute } from "../_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
    return groundingRoute(request, service => service.personalContext());
}
export async function PATCH(request: Request) {
    return groundingRoute(request, async service => {
        const body: unknown = await request.json().catch(() => null);
        if (body === null) throw new ContextPortErrorV0("Invalid personal context request.", 400);
        // Joseph's canonical schema validates selected roles, primary and CAS revision.
        return service.saveRoles(body);
    });
}
