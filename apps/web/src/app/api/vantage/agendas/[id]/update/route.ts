import { error, vantageContext } from "../../../_http";
import { VANTAGE_SHARING_DISABLED } from "~/server/vantage/access";

// The synthetic milestone has no program update or external delivery surface.
export async function GET() {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    return error(VANTAGE_SHARING_DISABLED, 403, { code: "sharing_disabled" });
}
