import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("auth.signUp");
    return {
        title: t("metaTitle"),
        description: t("metaDescription"),
        alternates: {
            canonical: "/signup",
        },
    };
}

export default function SignupLayout({ children }: { children: React.ReactNode }) {
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
