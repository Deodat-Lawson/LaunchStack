import { connection } from "next/server";

import { JoinLanding } from "~/app/_components/join/JoinLanding";
import { enabledSocialProviders } from "~/server/auth/providers";

/**
 * `/join/<code>` — the link an admin copies from Settings › People and sends
 * however they like. Public: the preview needs no session, and the page signs
 * people up or in itself. Joining needs a session.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
    // Per request, not at build: a prebuilt image learns its social providers
    // from the environment it runs in.
    await connection();
    const { code } = await params;
    return (
        <JoinLanding source={{ kind: "link", code }} socialProviders={enabledSocialProviders()} />
    );
}
