// PATCH /api/company/profile/sources/[documentId] — { override: "about_us" | "set_aside" | null }
// A person's decision about whether a source speaks for the company. settings.manage.
// The source is re-read and the profile reassembled after the response.
import { z } from "zod";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { setSourceOverride } from "~/server/company-profile/service";
import { error, handleRouteError, json, readJsonBody } from "~/server/distribution/http";
import { requestTranslator } from "~/i18n/server";

const OverrideSchema = z.object({
    override: z.enum(["about_us", "set_aside"]).nullable(),
});

type Params = { params: Promise<{ documentId: string }> };

export async function PATCH(request: Request, { params }: Params) {
    const auth = await requireWorkspacePermission("settings.manage");
    if (!auth.success) return auth.response;
    const { documentId } = await params;
    const id = Number(documentId);
    const t = requestTranslator(request, "companyProfile.server.errors");
    if (!Number.isInteger(id) || id <= 0) return error(t("sourceNotFound"), 404);
    const parsed = OverrideSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return error(t("overrideValues"), 400);
    try {
        return json({ profile: await setSourceOverride(auth.data, id, parsed.data.override) });
    } catch (err) {
        return handleRouteError("PATCH company profile source", err, request);
    }
}
