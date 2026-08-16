import type { ReactNode } from "react";
import { DriftShell } from "./_chrome/DriftShell";
import { EmployerWorkspaceSwitcherProvider } from "./_chrome/EmployerWorkspaceSwitcherContext";
import { getWorkspaceSwitcherPayload } from "./_chrome/getWorkspaceSwitcherPayload";
import { Toaster } from "~/components/ui/sonner";

export default async function EmployerLayout({ children }: { children: ReactNode }) {
    const workspaceSwitcher = await getWorkspaceSwitcherPayload();

    return (
        <div
            className="lsw-root"
            style={{
                minHeight: "100vh",
                width: "100%",
            }}
        >
            <EmployerWorkspaceSwitcherProvider value={workspaceSwitcher}>
                <DriftShell>{children}</DriftShell>
            </EmployerWorkspaceSwitcherProvider>
            <Toaster richColors position="top-right" />
        </div>
    );
}
