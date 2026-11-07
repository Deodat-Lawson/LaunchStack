// PATCH /api/company/profile/facts — { path, value, label? } a person's edit to one fact.
// An empty value removes the fact, and the removal survives rebuilds; reset: true drops
// the edit so the sources' value comes back. settings.manage.
import { z } from "zod";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { CompanyProfileError, editFact } from "~/server/company-profile/service";
import { error, handleRouteError, json, readJsonBody } from "~/server/distribution/http";
import { localeOfRequest, requestTranslator } from "~/i18n/server";
import { wordEnglish } from "~/i18n/translate";

const EditSchema = z.object({
    path: z.string().min(1).max(160),
    value: z.string().max(2_000),
    label: z.string().max(120).optional(),
    reset: z.boolean().optional(),
});

export async function PATCH(request: Request) {
    const auth = await requireWorkspacePermission("settings.manage");
    if (!auth.success) return auth.response;
    const parsed = EditSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
        return error(
            requestTranslator(request, "companyProfile.server.errors")("editNeedsPathValue"),
            400
        );
    }
    try {
        return json({ profile: await editFact(auth.data, parsed.data) });
    } catch (err) {
        // A refused edit carries the company-metadata package's own English.
        if (err instanceof CompanyProfileError && !err.copy) {
            const words = wordEnglish(
                err.message,
                "companyProfile.server.editErrors",
                localeOfRequest(request)
            );
            return error(words, err.status, { code: err.code });
        }
        return handleRouteError("PATCH company profile fact", err, request);
    }
}
