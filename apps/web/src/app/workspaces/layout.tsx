import type { ReactNode } from "react";

import { SignInNotice } from "~/components/auth/SignInNotice";

export default function WorkspacesLayout({ children }: { children: ReactNode }) {
    return (
        <div
            style={{
                minHeight: "100vh",
                width: "100%",
            }}
        >
            {children}
            <SignInNotice />
        </div>
    );
}
