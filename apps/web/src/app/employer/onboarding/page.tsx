"use client";

import { useTranslations } from "next-intl";

import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import { PageShell } from "~/components/layout/page-shell";

import { OnboardingFlow } from "./_components/OnboardingFlow";

/**
 * Where a new workspace starts, from signup and from the workspace picker,
 * and where Settings › Company sends someone to go through it again.
 */
export default function OnboardingPage() {
    const t = useTranslations("onboarding.page");
    return (
        <>
            <EmployerChrome pageLabel={t("label")} pageTitle={t("title")} />
            <PageShell>
                <OnboardingFlow />
            </PageShell>
        </>
    );
}
