"use client";

/**
 * `/employer/settings` renders Settings — yours alone — the same surface the
 * workspace mounts as a Studio tab. Every deep link that ever pointed here
 * still lands: `#account` or `#appearance.theme` on its section, what
 * belongs to the workspace now (`#people`, `#byok`) on its screen of the
 * Workspace tab, and `#usage.…` on the Usage tab's Spending screen (see
 * `~/lib/settings/surfaces`).
 */

import { useTranslations } from "next-intl";

import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import { SettingsHub } from "~/app/employer/documents/_workspace/SettingsHub";

export default function SettingsPage() {
    const t = useTranslations("settings.page");
    return (
        <>
            <EmployerChrome pageLabel="Launchstack" pageTitle={t("title")} />
            <SettingsHub />
        </>
    );
}
