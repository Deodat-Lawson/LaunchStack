import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Connect an assistant",
    description:
        "Let an AI assistant search your LaunchStack workspace and save conversations to it.",
    robots: { index: false, follow: false },
};

export default function OAuthLayout({ children }: { children: React.ReactNode }) {
    return <div className="min-h-screen w-full">{children}</div>;
}
