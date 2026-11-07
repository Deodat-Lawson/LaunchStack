// POST /api/brand/connections/[id]/refresh — re-read the sign-in's profile and Pages (admins)
import type { NextRequest } from "next/server";

import { getBlueskyProfile } from "@launchstack/tools/social-publish/bluesky";

import { localeOfRequest } from "~/i18n/server";
import { listBrandAccounts } from "~/server/brand/accounts";
import {
    ChannelUnavailableError,
    channelsForConnections,
    discoverLinkedInChannels,
} from "~/server/brand/channels";
import { db } from "~/server/db";
import { brandChannels } from "~/server/db/schema/brand";
import { getConnectionById } from "~/server/services/connectors/connection-store";
import { eq } from "drizzle-orm";

import { brandReason } from "~/server/brand/words";

import { brandManageContext, brandT, error, handleBrandError, json } from "../../../_http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await brandManageContext(request);
    if (!auth.ok) return auth.response;
    try {
        const { id: raw } = await params;
        const id = Number(raw);
        const connection = Number.isSafeInteger(id) ? await getConnectionById(id) : null;
        if (!connection || connection.companyId !== auth.ctx.companyId)
            return error(brandT(request)("connectionNotFound"), 404);
        if (connection.provider === "linkedin") {
            try {
                await discoverLinkedInChannels(connection);
            } catch (refreshError) {
                if (refreshError instanceof ChannelUnavailableError)
                    return error(brandReason(refreshError.message, localeOfRequest(request)), 409);
                throw refreshError;
            }
        } else if (connection.provider === "bluesky") {
            const profile = await getBlueskyProfile(connection.providerAccountId);
            for (const channel of await channelsForConnections(auth.ctx.companyId, [
                connection.id,
            ])) {
                await db
                    .update(brandChannels)
                    .set({
                        name: profile.displayName ?? profile.handle,
                        handle: profile.handle,
                        avatarUrl: profile.avatarUrl,
                        followers: profile.followers,
                        updatedAt: new Date(),
                    })
                    .where(eq(brandChannels.id, channel.id));
            }
        } else {
            return error(brandT(request)("connectionNotFound"), 404);
        }
        const accounts = await listBrandAccounts(
            auth.ctx.companyId,
            true,
            true,
            localeOfRequest(request)
        );
        return json({ channels: accounts.channels.filter(c => c.connectionId === connection.id) });
    } catch (err) {
        return handleBrandError("POST refresh connection", err, request);
    }
}
