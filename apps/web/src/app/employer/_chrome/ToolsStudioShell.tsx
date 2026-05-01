"use client";

import type { ReactNode } from "react";

/**
 * Full-height wrapper for standalone tool routes. Navigation lives inside Studio controls.
 */
export function ToolsStudioShell({ children }: { children: ReactNode }) {
  return (
    <div
      data-drift-immersive="true"
      style={{
        display: "flex",
        height: "100vh",
        width: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
    </div>
  );
}
