import { error, vantageContext } from "../_http";
import { VANTAGE_SHARING_DISABLED } from "~/server/vantage/access";

export async function GET() {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    return error(VANTAGE_SHARING_DISABLED, 403, { code: "sharing_disabled" });
}
