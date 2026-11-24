/**
 * A public link that does not open: unknown, turned off, expired, switched
 * off for the workspace, or its file deleted. One calm page for all of them,
 * saying nothing about which (that would tell a guesser a token was real),
 * with no app chrome and no sign-in prompt.
 */

import { Link2Off } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { LaunchstackMark } from "~/app/_components/LaunchstackLogo";

export default async function PublicLinkNotFound() {
    const t = await getTranslations("publicShare.page.unavailable");
    return (
        <div className="bg-surface text-ink flex min-h-dvh flex-col items-center justify-center px-4 py-12">
            <main className="flex max-w-md flex-col items-center text-center">
                <div className="bg-panel-2 text-ink-3 mb-5 flex size-14 items-center justify-center rounded-2xl">
                    <Link2Off className="size-6" aria-hidden />
                </div>
                <h1 className="text-ink text-xl font-semibold">{t("title")}</h1>
                <p className="text-ink-2 mt-2 text-sm leading-relaxed">{t("body")}</p>
            </main>
            <footer className="text-ink-3 mt-12 flex items-center gap-2 text-xs">
                <LaunchstackMark size={16} title="Launchstack" />
                <span>Launchstack</span>
            </footer>
        </div>
    );
}
