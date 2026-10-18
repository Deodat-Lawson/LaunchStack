"use client";

/**
 * `/employer/settings` renders Settings — yours alone — the same surface the
 * workspace mounts as a Studio tab. Every deep link that ever pointed here
 * still lands: `#account` or `#appearance.theme` on its section, and what
 * belongs to the workspace now (`#people`, `#byok`, `#usage.…`) on its
 * screen of the Workspace tab (see `~/lib/settings/surfaces`).
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
