"use client";

/**
 * `/employer/settings` renders the same unified settings surface the workspace
 * mounts as a Studio pane — one implementation, two entry points. Existing
 * deep links (`#byok`, `#slack`, …) still land on the right section.
 */

import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import { SettingsHub } from "~/app/employer/documents/_workspace/SettingsHub";

export default function SettingsPage() {
    return (
        <>
            <EmployerChrome pageLabel="Launchstack" pageTitle="Settings" />
            <SettingsHub />
        </>
    );
}
