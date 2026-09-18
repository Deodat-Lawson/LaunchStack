"use client";

/**
 * Data and privacy — the trust surface.
 *
 * Body only. The top half is computed by the server from the same variables
 * the capabilities read, so it cannot drift from what actually happens. The
 * bottom half is the one member-scoped toggle and the retention settings
 * that live elsewhere, linked rather than duplicated.
 */

import React, { useEffect, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Card, Section } from "~/components/layout/page-shell";
import { useSettingsPayload } from "~/lib/settings/useSettings";

import type { SettingsSectionProps } from "./contract";
import { SectionRows } from "./SettingRow";
import { Code, StatusNote, StatusRow } from "./ui";

interface OutboundService {
    id: string;
    label: string;
    host: string | null;
    sends: "document-text" | "metadata" | "none";
    enabled: boolean;
    note: string;
}

interface PrivacyOverview {
    deploymentMode: "self-hosted" | "cloud";
    productAnalytics: boolean;
    services: OutboundService[];
}

const SENDS_LABEL: Record<OutboundService["sends"], string> = {
    "document-text": "Document text",
    metadata: "Metadata only",
    none: "Nothing",
};

export function PrivacySection(_: SettingsSectionProps) {
    const [overview, setOverview] = useState<PrivacyOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const settings = useSettingsPayload();
    const auditDays = settings.payload?.settings["workspace.auditRetentionDays"]?.value;
    const trashDays = settings.payload?.settings["retention.trashDays"]?.value;

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch("/api/settings/privacy");
                if (!res.ok)
                    throw new Error(`Could not load the privacy overview (${res.status}).`);
                const body = (await res.json()) as PrivacyOverview;
                if (!cancelled) setOverview(body);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : "Could not load.");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <>
            {error && <StatusNote tone="danger">{error}</StatusNote>}

            <Section
                title="Outside services"
                description="Computed from this deployment's configuration. Hosts only — no credential is read to build this list."
            >
                <Card>
                    {!overview ? (
                        <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                            Checking configuration…
                        </StatusNote>
                    ) : (
                        <>
                            <div className="text-ink-2 mb-2 text-[13px]">
                                This is a{" "}
                                <strong>
                                    {overview.deploymentMode === "cloud" ? "hosted" : "self-hosted"}
                                </strong>{" "}
                                deployment.{" "}
                                {overview.productAnalytics
                                    ? "Page views count toward the hosted product's usage analytics unless you opt out below."
                                    : "Nothing phones home: there is no product analytics script on this instance."}
                            </div>
                            {overview.services.map(service => (
                                <StatusRow
                                    key={service.id}
                                    label={service.label}
                                    ok={service.enabled}
                                    okLabel={SENDS_LABEL[service.sends]}
                                    offLabel="Off"
                                    detail={
                                        <>
                                            {service.host ? (
                                                <>
                                                    Talks to <Code>{service.host}</Code>.{" "}
                                                </>
                                            ) : null}
                                            {service.note}
                                        </>
                                    }
                                />
                            ))}
                        </>
                    )}
                </Card>
            </Section>

            <Section
                title="What is kept"
                description="Retention windows live where they are set; this is the summary."
            >
                <Card>
                    <StatusRow
                        label="Audit log"
                        ok={auditDays == null}
                        okLabel="Kept forever"
                        offLabel={typeof auditDays === "number" ? `${auditDays} days` : "…"}
                        detail={
                            <>
                                Set under People and access.{" "}
                                <a
                                    href="#workspace.auditRetentionDays"
                                    className="text-brand-ink underline"
                                >
                                    Change it
                                </a>
                                .
                            </>
                        }
                    />
                    <StatusRow
                        label="Trash"
                        ok={trashDays == null}
                        okLabel="Kept until deleted by hand"
                        offLabel={
                            typeof trashDays === "number" ? `Emptied after ${trashDays} days` : "…"
                        }
                        detail={
                            <>
                                Trashed maps and artifacts. Set under Archive and retention.{" "}
                                <a href="#retention.trashDays" className="text-brand-ink underline">
                                    Change it
                                </a>
                                .
                            </>
                        }
                    />
                    <StatusRow
                        label="Embedding credentials"
                        ok
                        okLabel="Encrypted at rest"
                        detail="Per-workspace keys are encrypted with EMBEDDING_SECRETS_KEY and only ever shown as their last four characters."
                    />
                </Card>
            </Section>

            <Section title="Your choices" description="Yours alone.">
                <Card>
                    <SectionRows section="privacy" />
                    {overview && !overview.productAnalytics && (
                        <div className="text-ink-3 mt-2 flex items-center gap-2 text-[12px]">
                            <Badge variant="secondary">No effect here</Badge>
                            This instance sends no analytics, so the switch changes nothing until it
                            runs on the hosted service.
                        </div>
                    )}
                </Card>
            </Section>
        </>
    );
}
