import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("auth.signIn");
    return {
        title: t("metaTitle"),
        description: t("metaDescription"),
        alternates: {
            canonical: "/signin",
        },
    };
}

export default function SigninLayout({ children }: { children: React.ReactNode }) {
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
