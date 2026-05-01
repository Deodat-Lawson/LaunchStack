import type { ReactNode } from "react";
import {
    inter,
    interTight,
    instrumentSerif,
    jetbrainsMono,
} from "../employer/fonts";

export default function WorkspacesLayout({ children }: { children: ReactNode }) {
    return (
        <div
            className={`lsw-root ${inter.variable} ${interTight.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable}`}
            style={{
                fontFamily:
                    "var(--font-inter-tight), var(--font-inter), system-ui, sans-serif",
                minHeight: "100vh",
                width: "100%",
            }}
        >
            {children}
        </div>
    );
}
