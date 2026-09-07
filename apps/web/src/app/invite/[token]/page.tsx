import { InviteLanding } from "./InviteLanding";

/**
 * `/invite/<token>` — the page an invitation email links to. Public: the
 * preview needs no session, and the page offers sign-in / sign-up with a
 * `next` back to itself. Accepting does need a session.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    return <InviteLanding token={token} />;
}
