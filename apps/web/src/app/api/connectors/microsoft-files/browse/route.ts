/**
 * The built-in OneDrive and SharePoint browser's one read endpoint.
 *
 *   GET ?                    the connected account's OneDrive, at its top
 *   GET ?driveId=&itemId=    one folder's files and folders (itemId
 *                            defaults to the drive's top)
 *   GET ?sites=<query>       SharePoint sites matching the query (every
 *                            site the account can see when it is empty)
 *   GET ?siteId=             that site's document libraries
 *
 * It reads as the workspace's connected account, so it needs
 * `connectors.manage`, like everything else on this connection.
 */

import { z } from "zod";

import {
    createMicrosoft365Client,
    Microsoft365AccessError,
    Microsoft365AuthError,
} from "@launchstack/pipelines/connectors/microsoft-365";
import {
    createNotFoundError,
    createSuccessResponse,
    createValidationError,
    handleApiError,
} from "~/lib/api-utils";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import {
    browseFolder,
    browseMyDrive,
    browseSiteDrives,
    browseSites,
} from "~/server/services/connectors/microsoft-365/browse";
import { primaryMicrosoft365Connection } from "~/server/services/connectors/microsoft-365/connection";
import {
    notConfiguredResponse,
    requireConnectorAdmin,
} from "~/server/services/connectors/workspace-guard";
import { graphApiBaseUrl } from "~/server/services/microsoft/config";
import {
    getMicrosoftAccessToken,
    markMicrosoftConnectionRevoked,
} from "~/server/services/microsoft/connections";
import { MicrosoftAuthError } from "~/server/services/microsoft/oauth";

export const runtime = "nodejs";

const QuerySchema = z
    .object({
        driveId: z.string().min(1).max(128).optional(),
        itemId: z.string().min(1).max(128).optional(),
        sites: z.string().max(200).optional(),
        siteId: z.string().min(1).max(256).optional(),
    })
    .refine(query => !query.itemId || query.driveId, { path: ["driveId"] })
    .refine(
        query =>
            [query.driveId, query.sites, query.siteId].filter(value => value !== undefined)
                .length <= 1,
        { path: ["siteId"] }
    );

export async function GET(request: Request) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "sources.server.microsoft365");
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;
            if (!isConnectorConfigured("microsoft-365")) {
                return notConfiguredResponse("microsoft-365", locale);
            }

            const params = new URL(request.url).searchParams;
            const query = QuerySchema.safeParse({
                driveId: params.get("driveId") ?? undefined,
                itemId: params.get("itemId") ?? undefined,
                sites: params.get("sites") ?? undefined,
                siteId: params.get("siteId") ?? undefined,
            });
            if (!query.success) return createValidationError(t("browseInvalid"));

            const connection = await primaryMicrosoft365Connection(guard.ctx.companyId);
            if (!connection) return createNotFoundError(t("connectFirst"));
            if (connection.status !== "active") return createValidationError(t("revoked"));

            try {
                const client = createMicrosoft365Client({
                    accessToken: await getMicrosoftAccessToken(connection),
                    baseUrl: graphApiBaseUrl(),
                });
                const { driveId, itemId, sites, siteId } = query.data;
                if (sites !== undefined) {
                    return createSuccessResponse({ sites: await browseSites(client, sites) });
                }
                if (siteId !== undefined) {
                    return createSuccessResponse({
                        drives: await browseSiteDrives(client, siteId, t("libraryFallback")),
                    });
                }
                if (driveId !== undefined) {
                    return createSuccessResponse({
                        drive: null,
                        ...(await browseFolder(client, driveId, itemId ?? "root")),
                    });
                }
                return createSuccessResponse(await browseMyDrive(client, t("myOneDrive")));
            } catch (error) {
                if (error instanceof Microsoft365AccessError) {
                    return createNotFoundError(t("browseNotFound"));
                }
                // The token is dead at Microsoft: the panel turns into Reconnect.
                if (error instanceof Microsoft365AuthError) {
                    await markMicrosoftConnectionRevoked(connection.id, error.message);
                    return createValidationError(t("revoked"));
                }
                if (error instanceof MicrosoftAuthError && error.invalidGrant) {
                    return createValidationError(t("revoked"));
                }
                throw error;
            }
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
