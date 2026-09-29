import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Deployment Guide — Self-Host Launchstack",
    description:
        "Deploy the current Launchstack app and worker. Configure Docker, chat models, embeddings, storage, document services, and workspace connections.",
    alternates: { canonical: "/deployment" },
};

export default function DeploymentLayout({ children }: { children: React.ReactNode }) {
    return children;
}
