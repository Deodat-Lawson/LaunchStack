import type { ReactNode } from "react";

import { AccountChangeGuard } from "~/components/auth/AccountChangeGuard";
import { SignInNotice } from "~/components/auth/SignInNotice";
import { getServerSession } from "~/server/auth";
import { FeedbackProvider } from "~/components/feedback/FeedbackProvider";
import { Toaster } from "~/components/ui/sonner";

export default async function WorkspacesLayout({ children }: { children: ReactNode }) {
    const session = await getServerSession();
    return (
        <div
            style={{
                minHeight: "100vh",
                width: "100%",
            }}
        >
            {/* The picker is signed in too: a bug in joining or switching is reportable here. */}
            <FeedbackProvider>
                {children}
                <SignInNotice />
                {/* Another tab switching account stops this one. */}
                {session ? (
                    <AccountChangeGuard
                        userId={session.user.id}
                        userName={session.user.name || session.user.email}
                    />
                ) : null}
            </FeedbackProvider>
            <Toaster richColors position="top-right" />
        </div>
    );
}
