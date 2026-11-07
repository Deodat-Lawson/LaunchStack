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
import { useTranslations } from "next-intl";

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
    /** OCR only: which PDFs are read with OCR, and the engines in the order tried. */
    ocr?: OcrPlan;
}

/** Mirrors `OcrPlan` in server/settings/privacy.ts. */
interface OcrPlan {
    scope: "none" | "all" | "scans" | "picked";
    order: string[];
}

interface PrivacyOverview {
    deploymentMode: "self-hosted" | "cloud";
    productAnalytics: boolean;
    services: OutboundService[];
}

const SENDS_KEY = {
    "document-text": "documentText",
    metadata: "metadata",
    none: "none",
} as const satisfies Record<OutboundService["sends"], string>;

type PrivacyT = ReturnType<typeof useTranslations<"settings.privacy">>;

/** Message keys of the services the server lists (`server/settings/privacy.ts`), by id. */
const SERVICE_KEYS = {
    chat: "chat",
    embedding: "embedding",
    rerank: "rerank",
    ner: "ner",
    ocr: "ocr",
    transcription: "transcription",
    email: "email",
    slack: "slack",
    drive: "drive",
    notion: "notion",
    "sec-edgar": "secEdgar",
} as const;
type ServiceKey = (typeof SERVICE_KEYS)[keyof typeof SERVICE_KEYS];

/** Services whose name is a brand, said the same in every language. */
const BRAND_SERVICES = new Set<ServiceKey>(["ocr", "slack", "drive", "notion"]);

// The server writes these in English; they are recognised here so the
// reader's language can say them. Anything else is shown as it came.
const AI_LOCAL = "Runs on this deployment's own servers.";
const AI_THIRD_PARTY = "Sent to a third-party AI model provider.";

/** Catalogue keys for the OCR engines the server names in its plan. */
const OCR_ENGINE_KEYS: Record<string, "azure" | "docling" | "landingAi" | "datalab"> = {
    AZURE: "azure",
    DOCLING: "docling",
    LANDING_AI: "landingAi",
    DATALAB: "datalab",
};

/**
 * The OCR note in the reader's language, from the server's plan: which PDFs
 * go to OCR, the engines in order, and what happens when none can read a
 * page. The English the server also sends is for API callers.
 */
export function ocrNote(t: PrivacyT, plan: OcrPlan): string {
    if (plan.scope === "none") return t("services.ocr.none");
    const engines = plan.order.map(id => {
        const key = OCR_ENGINE_KEYS[id];
        return key ? t(`services.ocr.engines.${key}`) : id;
    });
    const [lead, ...rest] = engines;
    const chain =
        rest.length > 0
            ? t("services.ocr.chainWithFallback", {
                  lead: lead ?? "",
                  rest: rest.join(t("services.ocr.listJoin")),
              })
            : t("services.ocr.chain", { lead: lead ?? "" });
    // Only text-layer-first skips the text-layer fallback; a PDF someone picks
    // a provider for still gets it (processor.ts sets nativeFallback).
    const end = plan.scope === "scans" ? t("services.ocr.retryOnly") : t("services.ocr.lastResort");
    return t("services.ocr.note", { scope: t(`services.ocr.scope.${plan.scope}`), chain, end });
}

/** A service's name and note in the reader's language. */
function serviceCopy(t: PrivacyT, service: OutboundService): { label: string; note: string } {
    const key = (SERVICE_KEYS as Record<string, ServiceKey | undefined>)[service.id];
    if (!key) return { label: service.label, note: service.note };
    const label = BRAND_SERVICES.has(key) ? service.label : t(`services.${key}.label` as never);
    let note = service.note;
    let prefix: string | null = null;
    if (note.startsWith(`${AI_LOCAL} `)) {
        prefix = t("services.aiLocal");
        note = note.slice(AI_LOCAL.length + 1);
    } else if (note.startsWith(`${AI_THIRD_PARTY} `)) {
        prefix = t("services.aiThirdParty");
        note = note.slice(AI_THIRD_PARTY.length + 1);
    }
    let shown: string;
    if (key === "ocr") {
        shown = service.ocr ? ocrNote(t, service.ocr) : note;
    } else {
        shown = t(`services.${key}.note` as never);
    }
    return { label, note: prefix ? t("services.withPrefix", { prefix, note: shown }) : shown };
}

export function PrivacySection(_: SettingsSectionProps) {
    const t = useTranslations("settings.privacy");
    const tc = useTranslations("common");
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
                if (!res.ok) throw new Error(t("loadFailedStatus", { status: res.status }));
                const body = (await res.json()) as PrivacyOverview;
                if (!cancelled) setOverview(body);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : t("loadFailed"));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [t]);

    return (
        <>
            {error && <StatusNote tone="danger">{error}</StatusNote>}

            <Section title={t("outside.title")} description={t("outside.description")}>
                <Card>
                    {!overview ? (
                        <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                            {t("outside.checking")}
                        </StatusNote>
                    ) : (
                        <>
                            <div className="text-ink-2 mb-2 text-[13px]">
                                {t.rich(
                                    overview.productAnalytics
                                        ? "outside.deploymentAnalyticsOn"
                                        : "outside.deploymentAnalyticsOff",
                                    {
                                        mode:
                                            overview.deploymentMode === "cloud" ? "cloud" : "self",
                                        strong: chunks => <strong>{chunks}</strong>,
                                    }
                                )}
                            </div>
                            {overview.services.map(service => {
                                const copy = serviceCopy(t, service);
                                return (
                                    <StatusRow
                                        key={service.id}
                                        label={copy.label}
                                        ok={service.enabled}
                                        okLabel={t(`sends.${SENDS_KEY[service.sends]}`)}
                                        offLabel={tc("status.off")}
                                        detail={
                                            service.host
                                                ? t.rich("outside.talksTo", {
                                                      host: service.host,
                                                      note: copy.note,
                                                      code: chunks => <Code>{chunks}</Code>,
                                                  })
                                                : copy.note
                                        }
                                    />
                                );
                            })}
                        </>
                    )}
                </Card>
            </Section>

            <Section title={t("kept.title")} description={t("kept.description")}>
                <Card>
                    <StatusRow
                        label={t("kept.audit.label")}
                        ok={auditDays == null}
                        okLabel={t("kept.audit.keptForever")}
                        offLabel={
                            typeof auditDays === "number"
                                ? t("kept.audit.days", { days: auditDays })
                                : "…"
                        }
                        detail={t.rich("kept.audit.detail", {
                            link: chunks => (
                                <a
                                    href="#workspace.auditRetentionDays"
                                    className="text-brand-ink underline"
                                >
                                    {chunks}
                                </a>
                            ),
                        })}
                    />
                    <StatusRow
                        label={t("kept.trash.label")}
                        ok={trashDays == null}
                        okLabel={t("kept.trash.keptUntilDeleted")}
                        offLabel={
                            typeof trashDays === "number"
                                ? t("kept.trash.emptiedAfter", { days: trashDays })
                                : "…"
                        }
                        detail={t.rich("kept.trash.detail", {
                            link: chunks => (
                                <a href="#retention.trashDays" className="text-brand-ink underline">
                                    {chunks}
                                </a>
                            ),
                        })}
                    />
                    <StatusRow
                        label={t("kept.credentials.label")}
                        ok
                        okLabel={t("kept.credentials.okLabel")}
                        detail={t("kept.credentials.detail")}
                    />
                </Card>
            </Section>

            <Section title={t("choices.title")} description={t("choices.description")}>
                <Card>
                    <SectionRows section="privacy" />
                    {overview && !overview.productAnalytics && (
                        <div className="text-ink-3 mt-2 flex items-center gap-2 text-[12px]">
                            <Badge variant="secondary">{t("choices.noEffect")}</Badge>
                            {t("choices.noEffectBody")}
                        </div>
                    )}
                </Card>
            </Section>
        </>
    );
}
