import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Join a workspace",
    description: "You've been invited to a Launchstack workspace.",
    robots: { index: false, follow: false },
};

export default function InviteLayout({ children }: { children: React.ReactNode }) {
    return <div className="min-h-screen w-full">{children}</div>;
}
