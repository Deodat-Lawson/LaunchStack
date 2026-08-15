import type { ReactNode } from "react";

export default function WorkspacesLayout({ children }: { children: ReactNode }) {
    return (
        <div
            className="lsw-root"
            style={{
                minHeight: "100vh",
                width: "100%",
            }}
        >
            {children}
        </div>
    );
}
