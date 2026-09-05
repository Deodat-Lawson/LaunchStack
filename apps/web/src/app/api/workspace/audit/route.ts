import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { AuditQuerySchema } from "~/lib/validation";
import { exportAuditCsv, listAuditEvents } from "~/server/workspace/audit";
import { parseValue, queryObject, workspaceErrorResponse } from "~/server/workspace/http";

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("audit.view");
    if (!ctx.success) return ctx.response;
    const query = parseValue(queryObject(request), AuditQuerySchema);
    if (!query.success) return query.response;
    try {
        if (query.data.format === "csv") {
            const csv = await exportAuditCsv(ctx.data, query.data);
            return new NextResponse(csv, {
                status: 200,
                headers: {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": 'attachment; filename="audit.csv"',
                },
            });
        }
        return NextResponse.json(await listAuditEvents(ctx.data, query.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/audit GET]");
    }
}
