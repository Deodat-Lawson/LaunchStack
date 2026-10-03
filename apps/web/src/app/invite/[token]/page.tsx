import { connection } from "next/server";

import { JoinLanding } from "~/app/_components/join/JoinLanding";
import { enabledSocialProviders } from "~/server/auth/providers";

/**
 * `/invite/<token>` — the link in an invitation (emailed when a provider is
 * configured, otherwise copied and sent by the admin). Public: the preview
 * needs no session, and the page signs people up or in itself, with the
 * invited address filled in. Accepting needs a session with that address.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
    await connection();
    const { token } = await params;
    return (
        <JoinLanding
            source={{ kind: "invite", token }}
            socialProviders={enabledSocialProviders()}
        />
    );
}
