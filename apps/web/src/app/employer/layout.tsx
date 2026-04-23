import type { ReactNode } from "react";
import { inter, instrumentSerif, jetbrainsMono } from "./fonts";

/**
 * Employer root layout.
 * Every page under /employer/* renders inside `.lsw-root`, which scopes the
 * Launchstack OKLCH token system. Individual pages opt into full-width chrome
 * by rendering <EmployerChrome /> themselves; /employer/documents stays
 * immersive with no top chrome.
 */
export default function EmployerLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`lsw-root ${inter.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable}`}
      style={{
        fontFamily: `var(--font-inter), system-ui, sans-serif`,
        minHeight: "100vh",
        width: "100%",
      }}
    >
      {children}
    </div>
  );
}
