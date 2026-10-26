import { loadPersonalContext } from "~/server/vantage/personal-context";
import { personalContextRoute } from "../_http";
export const dynamic = "force-dynamic";
export function GET() {
    return personalContextRoute(ctx => loadPersonalContext(ctx));
}
