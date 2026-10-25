import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("auth.join");
    return {
        title: t("metaTitle"),
        description: t("metaDescription"),
        robots: { index: false, follow: false },
    };
}

export default function InviteLayout({ children }: { children: React.ReactNode }) {
    return <div className="min-h-screen w-full">{children}</div>;
}
