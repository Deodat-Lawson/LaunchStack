import type { ReactNode } from "react";

export default function WorkspacesLayout({ children }: { children: ReactNode }) {
    return (
        <div
            style={{
                minHeight: "100vh",
                width: "100%",
            }}
        >
            {children}
        </div>
    );
}
