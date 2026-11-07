import Link from "next/link";
import { ArrowLeft, Check, Construction } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "~/components/ui/button";
import { LogoLink } from "~/components/LogoLink";
import { isSignedInRequest } from "~/server/auth";
import { LaunchstackMark } from "../_components/LaunchstackLogo";

/** A feature that is listed but not shipped. Same frame as the 404 page. */
export default async function FeatureUnavailable() {
    const t = await getTranslations("errors.unavailable");
    const signedIn = await isSignedInRequest();
    return (
        <div className="bg-surface text-ink flex min-h-screen flex-col items-center justify-center px-4 py-12">
            <div className="w-full max-w-md text-center">
                <div className="mb-10 flex justify-center">
                    <LogoLink signedIn={signedIn} className="flex items-center gap-2">
                        <LaunchstackMark size={26} title="Launchstack" />
                        <span className="text-lg font-bold">Launchstack</span>
                    </LogoLink>
                </div>

                <div className="bg-brand-soft text-brand-ink mx-auto mb-6 flex size-14 items-center justify-center rounded-2xl">
                    <Construction className="size-7" aria-hidden />
                </div>
                <h1 className="display text-ink mb-3 text-[28px] leading-[1.15] tracking-tight">
                    {t("title")}
                </h1>
                <p className="text-ink-2 mb-8 leading-relaxed">{t("body")}</p>

                <div className="border-line bg-panel mb-8 rounded-xl border p-5 text-left">
                    <h2 className="text-ink mb-3 text-sm font-semibold">{t("meanwhile")}</h2>
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {[t("explore"), t("docs"), t("contact")].map(item => (
                            <li key={item} className="text-ink-2 flex items-start gap-2 text-sm">
                                <Check
                                    className="text-brand-ink mt-0.5 size-4 shrink-0"
                                    aria-hidden
                                />
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>

                <Button asChild>
                    <Link href="/">
                        <ArrowLeft />
                        {t("backHome")}
                    </Link>
                </Button>
            </div>
        </div>
    );
}
