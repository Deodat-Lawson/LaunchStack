"use client";

import { Resizable } from "re-resizable";
import type { ReactNode } from "react";

interface ResizablePanelProps {
  children: ReactNode;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  position: "left" | "right";
  className?: string;
}

export function ResizablePanel({
  children,
  defaultWidth,
  minWidth,
  maxWidth,
  position,
  className = "",
}: ResizablePanelProps) {
  const enable = position === "left" 
    ? { right: true } 
    : { left: true };

  const handleStyles = position === "left"
    ? {
        right: {
          width: "8px",
          right: "-4px",
          cursor: "col-resize",
          background: "transparent",
          zIndex: 10,
        } as React.CSSProperties,
      }
    : {
        left: {
          width: "8px",
          left: "-4px",
          cursor: "col-resize",
          background: "transparent",
          zIndex: 10,
        } as React.CSSProperties,
      };

  return (
    <Resizable
      defaultSize={{
        width: defaultWidth,
        height: "100%",
      }}
      minWidth={minWidth}
      maxWidth={maxWidth}
      enable={enable}
      handleStyles={handleStyles}
      handleClasses={{
        right: "resize-handle-right",
        left: "resize-handle-left",
      }}
      className={className}
      style={{ position: "relative", flexShrink: 0 }}
    >
      <div className="h-full w-full overflow-hidden">
        {children}
      </div>
    </Resizable>
  );
}

