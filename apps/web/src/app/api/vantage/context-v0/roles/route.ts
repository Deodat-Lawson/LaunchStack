import { savePersonalRoles } from "~/server/vantage/personal-context";
import { contextBody, personalContextRoute } from "../_http";
export const dynamic = "force-dynamic";
export function PATCH(request: Request) {
    return personalContextRoute(async ctx => savePersonalRoles(ctx, await contextBody(request)));
}
