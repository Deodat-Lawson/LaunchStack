"use client";

import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import { PageShell } from "~/components/layout/page-shell";

import { OnboardingFlow } from "./_components/OnboardingFlow";

/**
 * Where a new workspace starts, from signup and from the workspace picker,
 * and where Settings › Company sends someone to go through it again.
 */
export default function OnboardingPage() {
    return (
        <>
            <EmployerChrome pageLabel="First steps" pageTitle="Set up your workspace" />
            <PageShell>
                <OnboardingFlow />
            </PageShell>
        </>
    );
}
