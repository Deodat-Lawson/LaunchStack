import type { ReactNode } from "react";

import { SignInNotice } from "~/components/auth/SignInNotice";
import { FeedbackProvider } from "~/components/feedback/FeedbackProvider";
import { Toaster } from "~/components/ui/sonner";

export default function WorkspacesLayout({ children }: { children: ReactNode }) {
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
            </FeedbackProvider>
            <Toaster richColors position="top-right" />
        </div>
    );
}
