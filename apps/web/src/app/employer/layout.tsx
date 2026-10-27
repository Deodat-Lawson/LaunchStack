import type { ReactNode } from "react";
import { DriftShell } from "./_chrome/DriftShell";
import { PreferenceSync } from "./_chrome/PreferenceSync";
import { EmployerWorkspaceSwitcherProvider } from "./_chrome/EmployerWorkspaceSwitcherContext";
import { getWorkspaceSwitcherPayload } from "./_chrome/getWorkspaceSwitcherPayload";
import { JoinWelcome } from "./_chrome/JoinWelcome";
import { SignInNotice } from "~/components/auth/SignInNotice";
import { FeedbackProvider } from "~/components/feedback/FeedbackProvider";
import { Toaster } from "~/components/ui/sonner";

export default async function EmployerLayout({ children }: { children: ReactNode }) {
    const workspaceSwitcher = await getWorkspaceSwitcherPayload();

    return (
        <div
            style={{
                minHeight: "100vh",
                width: "100%",
            }}
        >
            <EmployerWorkspaceSwitcherProvider value={workspaceSwitcher}>
                {/* Every signed-in page can report a bug or ask for a feature. */}
                <FeedbackProvider>
                    <PreferenceSync />
                    <DriftShell>{children}</DriftShell>
                    <JoinWelcome />
                    <SignInNotice />
                </FeedbackProvider>
            </EmployerWorkspaceSwitcherProvider>
            <Toaster richColors position="top-right" />
        </div>
    );
}
