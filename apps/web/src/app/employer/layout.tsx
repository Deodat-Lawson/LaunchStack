import type { ReactNode } from "react";
import { inter, interTight, instrumentSerif, jetbrainsMono } from "./fonts";
import { DriftShell } from "./_chrome/DriftShell";
import { EmployerWorkspaceSwitcherProvider } from "./_chrome/EmployerWorkspaceSwitcherContext";
import { getWorkspaceSwitcherPayload } from "./_chrome/getWorkspaceSwitcherPayload";

export default async function EmployerLayout({ children }: { children: ReactNode }) {
  const workspaceSwitcher = await getWorkspaceSwitcherPayload();

  return (
    <div
      className={`lsw-root ${inter.variable} ${interTight.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable}`}
      style={{
        fontFamily: `var(--font-inter-tight), var(--font-inter), system-ui, sans-serif`,
        minHeight: "100vh",
        width: "100%",
      }}
    >
      <EmployerWorkspaceSwitcherProvider value={workspaceSwitcher}>
        <DriftShell>{children}</DriftShell>
      </EmployerWorkspaceSwitcherProvider>
    </div>
  );
}
