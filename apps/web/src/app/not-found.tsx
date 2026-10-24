import Link from "next/link";
import { LogIn, BookOpen } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { IconGithub } from "~/components/icons/brand";
import type { Metadata } from "next";
import { LaunchstackMark } from "./_components/LaunchstackLogo";
import { LandingLogoLink } from "~/components/LandingLogoLink";
import { LANDING_DEPLOYMENT_HREF } from "~/config/landing";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("errors.notFound");
    return { title: t("metaTitle"), description: t("metaDescription") };
}

const GITHUB_REPO = "https://github.com/Deodat-Lawson/LaunchStack";

export default async function NotFound() {
    const t = await getTranslations("errors.notFound");
    return (
        <div className="bg-surface text-ink flex min-h-screen flex-col items-center justify-center px-4 transition-colors duration-200">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,var(--accent-soft),transparent)]" />

            <div className="relative max-w-lg text-center">
                <div className="mb-8 flex justify-center">
                    <LandingLogoLink className="flex items-center gap-2">
                        <LaunchstackMark size={26} title="Launchstack" />
                        <span className="text-lg font-bold">Launchstack</span>
                    </LandingLogoLink>
                </div>

                <h1 className="text-brand-ink mb-4 text-7xl font-bold md:text-8xl">404</h1>
                <h2 className="mb-3 text-2xl font-bold md:text-3xl">{t("title")}</h2>
                <p className="text-ink-2 mb-10 leading-relaxed">{t("body")}</p>

                {/*
                  /pricing, /about, /contact and /deployment used to be siblings
                  of this page. They live on the public site now (apps/landing),
                  so the only in-app destination left is sign-in — everything
                  else on this origin is behind it anyway.
                */}
                <div className="mb-12 flex flex-col justify-center gap-3 sm:flex-row">
                    <Link href="/signin">
                        <button className="bg-brand text-brand-fg hover:bg-brand-hi flex w-full cursor-pointer items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-colors sm:w-auto">
                            <LogIn className="h-4 w-4" />
                            {t("signIn")}
                        </button>
                    </Link>
                </div>

                <div className="text-ink-3 flex flex-wrap justify-center gap-6 text-sm">
                    <a
                        href={LANDING_DEPLOYMENT_HREF}
                        rel="noopener"
                        className="hover:text-brand-ink flex items-center gap-1.5 transition-colors"
                    >
                        <BookOpen className="h-3.5 w-3.5" /> {t("deploymentGuide")}
                    </a>
                    <a
                        href={GITHUB_REPO}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-brand-ink flex items-center gap-1.5 transition-colors"
                    >
                        <IconGithub size={14} /> GitHub
                    </a>
                </div>
            </div>
        </div>
    );
}
