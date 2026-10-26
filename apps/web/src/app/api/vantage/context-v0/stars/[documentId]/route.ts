import { setPersonalStar } from "~/server/vantage/personal-context";
import { contextBody, personalContextRoute } from "../../_http";
export const dynamic = "force-dynamic";
export function PUT(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
    return personalContextRoute(async ctx =>
        setPersonalStar(ctx, (await params).documentId, await contextBody(request))
    );
}
