"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
    const { theme = "system" } = useTheme();

    return (
        <Sonner
            theme={theme as ToasterProps["theme"]}
            className="toaster group"
            style={
                {
                    "--normal-bg": "var(--panel)",
                    "--normal-text": "var(--ink)",
                    "--normal-border": "var(--line)",
                } as React.CSSProperties
            }
            {...props}
        />
    );
};

export { Toaster };
