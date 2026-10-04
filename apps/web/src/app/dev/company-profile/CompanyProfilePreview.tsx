"use client";

import { useEffect, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/sonner";
import {
    CompanyProfileView,
    type ProfileSectionActions,
} from "~/components/company-profile/CompanyProfileView";
import { cn } from "~/lib/utils";

import {
    PROFILE_FIXTURES,
    isProfileFixture,
    resetCompanyProfileSim,
    simulateCompanyProfile,
    type ProfileFixture,
} from "./simulator";

/**
 * Mounts the real CompanyProfileView with `/api/company/profile*` answered
 * by the in-memory simulator. Installed at module scope so the first fetch
 * the view makes is already intercepted; the fixture is read from the URL
 * per request, so `?state=` picks it.
 */
let stubbed = false;
function stubApi() {
    if (stubbed || typeof window === "undefined") return;
    stubbed = true;
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const param = new URLSearchParams(window.location.search).get("state");
        const state: ProfileFixture = isProfileFixture(param) ? param : "ready";
        const simulated = await simulateCompanyProfile(
            new URL(url, window.location.origin),
            init,
            state
        );
        return simulated ?? real(input, init);
    };
}

stubApi();

const STATE_NOTE: Record<ProfileFixture, string> = {
    ready: "A LaunchStack-like profile: summary, facts, people, services, evidence, one override.",
    nothing: "LaunchStack Dev today: a research paper, test mindmaps and an empty PDF.",
    building: "A first build; sources are read one by one and it lands in about 7 s.",
    failed: "The last build failed and kept nothing.",
    stale: "Built nine days ago; a source changed since.",
    viewer: "Ready, seen by someone without settings.manage.",
    empty: "A workspace with no sources at all.",
};

function harnessHref(state: ProfileFixture, variant: "settings" | "proposals") {
    return `/dev/company-profile?state=${state}&variant=${variant}`;
}

export function CompanyProfilePreview({
    state,
    variant,
}: {
    state: ProfileFixture;
    variant: "settings" | "proposals";
}) {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        resetCompanyProfileSim(state);
        setReady(true);
    }, [state]);

    return (
        <div data-preview="company-profile" className="bg-surface text-ink flex min-h-dvh flex-col">
            <div className="bg-warn-soft text-warn border-warn/40 shrink-0 border-b px-4 py-1.5 text-center text-xs">
                Preview harness — no login, in-memory data; a reload starts over.{" "}
                {STATE_NOTE[state]}
            </div>
            <nav
                aria-label="Harness fixtures"
                className="border-line bg-panel flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-xs"
            >
                <span className="text-ink-3">State</span>
                {PROFILE_FIXTURES.map(s => (
                    <a
                        key={s}
                        href={harnessHref(s, variant)}
                        aria-current={s === state ? "page" : undefined}
                        className={cn(
                            "rounded-sm underline-offset-2 hover:underline",
                            s === state ? "text-brand-ink font-semibold" : "text-ink-2"
                        )}
                    >
                        {s}
                    </a>
                ))}
                <span className="text-ink-3 ml-2">Variant</span>
                {(["proposals", "settings"] as const).map(v => (
                    <a
                        key={v}
                        href={harnessHref(state, v)}
                        aria-current={v === variant ? "page" : undefined}
                        className={cn(
                            "rounded-sm underline-offset-2 hover:underline",
                            v === variant ? "text-brand-ink font-semibold" : "text-ink-2"
                        )}
                    >
                        {v}
                    </a>
                ))}
            </nav>
            {ready &&
                (variant === "settings" ? (
                    <SettingsFrame readOnly={state === "viewer"} />
                ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 [container-type:inline-size] max-sm:px-4">
                        <CompanyProfileView variant="proposals" />
                    </div>
                ))}
            <Toaster richColors position="top-right" />
        </div>
    );
}

/**
 * Stands in for the Settings hub's chrome around the company section: the
 * same header, title and action area, with the section's published action
 * rendered where the hub renders it (and hidden when read-only, as there).
 */
function SettingsFrame({ readOnly }: { readOnly: boolean }) {
    const [actions, setActions] = useState<ProfileSectionActions | null>(null);
    const busyLabel = actions?.primaryBusyLabel ?? `${actions?.primaryLabel ?? ""}…`;
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <header className="border-line bg-panel shrink-0 border-b px-7 pb-4 pt-[18px] max-sm:px-4">
                <div className="mx-auto flex w-full max-w-[1200px] items-start gap-4">
                    <div className="min-w-0 flex-1">
                        <div className="mono text-ink-3 mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em]">
                            Company
                            {readOnly && <Badge variant="secondary">Read-only</Badge>}
                        </div>
                        <h1 className="display text-ink m-0 text-[26px] leading-[1.15] tracking-[-0.02em]">
                            What your sources can prove
                        </h1>
                        <p className="text-ink-3 m-0 mt-[7px] max-w-[660px] text-[13px] leading-[1.55]">
                            Read from the sources written by or about your company, each fact with
                            the excerpt that proves it.
                        </p>
                    </div>
                    {!readOnly && actions?.primaryLabel && (
                        <Button
                            onClick={() => void actions.onPrimary?.()}
                            disabled={actions.busy ?? actions.disabled ?? false}
                            className="px-4 py-[9px]"
                        >
                            {actions.busy ? busyLabel : actions.primaryLabel}
                        </Button>
                    )}
                </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-[1200px] px-7 pb-[72px] pt-6 max-sm:px-4">
                    <CompanyProfileView variant="settings" onActions={setActions} />
                </div>
            </div>
        </div>
    );
}
