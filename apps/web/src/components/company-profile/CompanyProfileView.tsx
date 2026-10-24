"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { EvidenceRows, Cite } from "~/components/tools/Cite";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonBlock, SkeletonRows } from "~/components/tools/SkeletonRows";
import { CompanyProfileApiError, companyProfileApi } from "~/lib/company-profile/api";
import type {
    CompanyProfileDto,
    ProfileFactPatch,
    ProfileSourceDto,
    SourceOverride,
} from "~/lib/company-profile/dto";
import { useToolFormat } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";
import { cn } from "~/lib/utils";

import { EntriesSection, FactsSection } from "./FactsSection";
import { SourcesSection } from "./SourcesSection";
import { APPLICANT_KEY } from "./words";

/** `useTranslations("companyProfile")`. */
type ProfileT = ReturnType<typeof useTranslations<"companyProfile">>;

/** How often a building profile is asked again. */
const POLL_MS = 2500;

/**
 * What the Settings chrome renders in its action area — the same shape as
 * `SettingsSectionActions` in the hub, declared here so a shared component
 * does not reach into a route area for a type.
 */
export interface ProfileSectionActions {
    primaryLabel?: string;
    primaryBusyLabel?: string;
    onPrimary?: () => void | Promise<void>;
    busy?: boolean;
    disabled?: boolean;
}

export interface CompanyProfileViewProps {
    /**
     * `proposals`: a full tool screen with its own display header.
     * `settings`: a section body inside the Settings hub, which owns the
     * page title and the action area.
     */
    variant: "settings" | "proposals";
    /** Settings only: publishes Rebuild into the hub's action area. */
    onActions?: (actions: ProfileSectionActions | null) => void;
}

function errorMessage(t: ProfileT, e: unknown, fallback: string): string {
    if (e instanceof CompanyProfileApiError && e.generated)
        return t("requestFailed", { status: e.status });
    return e instanceof Error && e.message ? e.message : fallback;
}

/** Whole sentences one after another: a space between them in English, none in Chinese. */
function sentences(locale: string, parts: string[]): string {
    return new Intl.ListFormat(locale, { type: "unit", style: "narrow" }).format(parts);
}

/**
 * The company profile: what the workspace's sources can prove about the
 * company, fact by fact, each with the excerpt that proves it — and which
 * sources it was read from and which it set aside, and why. Settings ›
 * Company and Proposals › Profile both render this, over one store.
 */
export function CompanyProfileView({ variant, onActions }: CompanyProfileViewProps) {
    const t = useTranslations("companyProfile");
    const format = useToolFormat();
    const [pollMs, setPollMs] = useState<number | null>(null);
    const res = useResource("company-profile", () => companyProfileApi.get(), { pollMs });
    const { mutate, reload } = res;
    const p = res.data?.profile ?? null;
    const [starting, setStarting] = useState(false);
    const [busySource, setBusySource] = useState<number | null>(null);

    // Keep asking while the server is reading; stop the moment it is not.
    const serverBuilding = p?.status === "building";
    useEffect(() => setPollMs(serverBuilding ? POLL_MS : null), [serverBuilding]);

    const building = serverBuilding || starting;
    const hasSources = (p?.counts.sources ?? 0) > 0 || (p?.sources.length ?? 0) > 0;

    const take = useCallback((profile: CompanyProfileDto) => mutate(() => ({ profile })), [mutate]);

    const rebuild = useCallback(async () => {
        setStarting(true);
        try {
            const { profile } = await companyProfileApi.rebuild();
            take(profile);
        } catch (e) {
            toast.error(errorMessage(t, e, t("view.couldNotStart")));
        } finally {
            setStarting(false);
        }
    }, [take, t]);

    const saveFact = useCallback(
        async (patch: ProfileFactPatch) => {
            try {
                const { profile } = await companyProfileApi.patchFact(patch);
                take(profile);
                toast.success(
                    patch.reset
                        ? t("view.backToSources")
                        : patch.value.trim()
                          ? t("view.saved")
                          : t("view.removed")
                );
            } catch (e) {
                toast.error(errorMessage(t, e, t("view.couldNotSave")));
                throw e;
            }
        },
        [take, t]
    );

    const setSource = useCallback(
        async (source: ProfileSourceDto, override: SourceOverride | null) => {
            setBusySource(source.documentId);
            try {
                const { profile } = await companyProfileApi.setSource(source.documentId, {
                    override,
                });
                take(profile);
            } catch (e) {
                toast.error(errorMessage(t, e, t("view.couldNotChangeSource")));
            } finally {
                setBusySource(null);
            }
        },
        [take, t]
    );

    const rebuildLabel = building
        ? t("view.reading")
        : p?.status === "ready" || p?.status === "failed"
          ? t("view.rebuild")
          : t("view.build");
    const rebuildDisabled = !p || building || !hasSources;

    // In Settings the hub's chrome owns the action area — but it hides
    // actions from anyone without settings.manage, and anyone may rebuild.
    // So the chrome gets Rebuild only for an editor; a viewer gets it here.
    const chromeOwnsRebuild = variant === "settings" && !!onActions && p?.canEdit !== false;
    useEffect(() => {
        if (!chromeOwnsRebuild || !onActions) return;
        onActions({
            primaryLabel: rebuildLabel,
            primaryBusyLabel: t("view.reading"),
            onPrimary: () => void rebuild(),
            busy: building,
            disabled: rebuildDisabled,
        });
        return () => onActions(null);
    }, [chromeOwnsRebuild, onActions, rebuildLabel, rebuild, building, rebuildDisabled, t]);

    const rebuildButton = (
        <Button
            size="sm"
            variant={variant === "settings" ? "outline" : "default"}
            onClick={() => void rebuild()}
            disabled={rebuildDisabled}
        >
            {variant === "settings" && <RefreshCw className="size-3.5" />}
            {rebuildLabel}
        </Button>
    );

    const sub = !p
        ? undefined
        : building
          ? t("sub.reading")
          : p.status === "ready"
            ? t("sub.ready", {
                  facts: p.facts.length,
                  sources: p.counts.counted,
                  when: format.relativeTime(p.builtAt),
              })
            : p.status === "failed"
              ? t("sub.failed")
              : hasSources
                ? t("sub.toRead", { count: p.counts.sources })
                : t("sub.none");

    return (
        <div
            className={cn(
                "flex w-full flex-col gap-7 [container-type:inline-size]",
                variant === "proposals" && "mx-auto max-w-[1000px]"
            )}
            data-variant={variant}
        >
            {variant === "proposals" ? (
                <PageHeader
                    title={t("header.title")}
                    accent={t("header.accent")}
                    sub={<span aria-live="polite">{sub}</span>}
                    actions={rebuildButton}
                />
            ) : (
                <div className="@max-md:flex-col @max-md:items-start flex items-center justify-between gap-3">
                    <p className="text-ink-3 text-[13px]" aria-live="polite">
                        {sub ?? " "}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                        {p?.canEdit && hasSources && (
                            <SetupLink variant="ghost">{t("view.setupAgain")}</SetupLink>
                        )}
                        {!chromeOwnsRebuild && rebuildButton}
                    </div>
                </div>
            )}

            {p && !p.canEdit && <p className="text-ink-3 -mt-4 text-xs">{t("view.readOnly")}</p>}

            {res.error && <InlineError message={res.error} onRetry={() => void reload()} />}

            {p?.status === "failed" && !building && (
                <InlineError
                    message={p.error ?? t("view.lastBuildFailed")}
                    onRetry={hasSources ? () => void rebuild() : undefined}
                />
            )}

            {p?.stale && p.status === "ready" && !building && (
                <StaleBanner onRebuild={() => void rebuild()} disabled={rebuildDisabled} />
            )}

            <Body
                profile={p}
                loading={res.loading}
                building={building}
                hasSources={hasSources}
                rebuildButton={chromeOwnsRebuild ? null : rebuildButton}
                busySource={busySource}
                onSaveFact={saveFact}
                onSetSource={(source, override) => void setSource(source, override)}
            />
        </div>
    );
}

/** Onboarding: the website, what the company does, the idea, documents about it. */
function SetupLink({
    children,
    variant = "outline",
}: {
    children: ReactNode;
    variant?: "outline" | "ghost";
}) {
    return (
        <Button asChild size="sm" variant={variant}>
            <Link href="/employer/onboarding">{children}</Link>
        </Button>
    );
}

function StaleBanner({ onRebuild, disabled }: { onRebuild: () => void; disabled: boolean }) {
    const t = useTranslations("companyProfile.stale");
    return (
        <div
            role="status"
            className="border-line bg-panel-2 @max-md:flex-col @max-md:items-start flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
        >
            <p className="text-ink-2 text-[13px]">{t("body")}</p>
            <Button size="sm" variant="outline" onClick={onRebuild} disabled={disabled}>
                {t("rebuild")}
            </Button>
        </div>
    );
}

function Chip({ children }: { children: ReactNode }) {
    return (
        <li className="border-line text-ink-2 inline-flex min-h-[22px] items-center rounded-[11px] border px-2.5 py-0.5 text-[11.5px] leading-snug">
            {children}
        </li>
    );
}

function Body({
    profile: p,
    loading,
    building,
    hasSources,
    rebuildButton,
    busySource,
    onSaveFact,
    onSetSource,
}: {
    profile: CompanyProfileDto | null;
    loading: boolean;
    building: boolean;
    hasSources: boolean;
    rebuildButton: ReactNode;
    busySource: number | null;
    onSaveFact: (patch: ProfileFactPatch) => Promise<void>;
    onSetSource: (source: ProfileSourceDto, override: SourceOverride | null) => void;
}) {
    const t = useTranslations("companyProfile");
    if (loading || !p) {
        if (!loading) return null; // a failed first load: the error above says so
        return (
            <div className="flex flex-col gap-7" aria-busy="true" aria-label={t("view.loading")}>
                <SkeletonBlock lines={3} />
                <SkeletonRows rows={5} height={56} />
            </div>
        );
    }

    if (!hasSources) {
        return (
            <EmptyState
                title={t("empty.nothingTitle")}
                body={t("empty.nothingBody", { name: p.name })}
                action={
                    p.canEdit ? (
                        <SetupLink>{t("view.tellUs", { name: p.name })}</SetupLink>
                    ) : undefined
                }
            />
        );
    }

    const sources = (
        <SourcesSection
            sources={p.sources}
            canEdit={p.canEdit}
            building={building}
            busyId={busySource}
            onSetSource={onSetSource}
        />
    );

    const hasContent =
        p.facts.length > 0 ||
        p.people.length > 0 ||
        p.services.length > 0 ||
        p.projects.length > 0 ||
        Boolean(p.summary);

    if (!hasContent) {
        if (building) {
            return (
                <>
                    <div className="flex flex-col gap-3" aria-busy="true">
                        <p className="text-ink-2 text-sm">{t("view.buildingNote")}</p>
                        <SkeletonBlock lines={4} />
                    </div>
                    {sources}
                </>
            );
        }
        if (p.status === "empty") {
            return (
                <>
                    <EmptyState
                        title={t("empty.noProfileTitle")}
                        body={t("empty.noProfileBody", { count: p.counts.sources, name: p.name })}
                        action={rebuildButton ?? undefined}
                    />
                    {sources}
                </>
            );
        }
        if (p.status === "ready") {
            return (
                <>
                    <NothingProven profile={p} />
                    {sources}
                    <FactsSection
                        facts={p.facts}
                        evidence={p.evidence}
                        canEdit={p.canEdit}
                        onSave={onSaveFact}
                    />
                </>
            );
        }
        // Failed with nothing kept: the error is above; what was read is here.
        return sources;
    }

    return (
        <>
            {(Boolean(p.summary) || hasChips(p)) && (
                <section aria-label={t("view.summary")}>
                    {p.summary && (
                        <p className="text-ink max-w-[70ch] text-[14px] leading-relaxed">
                            {p.summary}
                            {p.summaryCites.map(n => (
                                <Cite key={n} n={n} evidence={p.evidence} />
                            ))}
                        </p>
                    )}
                    {hasChips(p) && (
                        <ul
                            className="mt-3 flex flex-wrap gap-1.5"
                            aria-label={t("view.atAGlance")}
                        >
                            {p.applicantType && (
                                <Chip>{t(`applicant.${APPLICANT_KEY[p.applicantType]}`)}</Chip>
                            )}
                            {p.focusAreas.map(f => (
                                <Chip key={`f:${f}`}>{f}</Chip>
                            ))}
                            {p.geography.map(g => (
                                <Chip key={`g:${g}`}>{g}</Chip>
                            ))}
                            {p.markets.map(m => (
                                <Chip key={`m:${m}`}>{m}</Chip>
                            ))}
                        </ul>
                    )}
                </section>
            )}

            <FactsSection
                facts={p.facts}
                evidence={p.evidence}
                canEdit={p.canEdit}
                onSave={onSaveFact}
            />
            <EntriesSection
                title={t("sections.people")}
                entries={p.people}
                evidence={p.evidence}
                canEdit={p.canEdit}
                onSave={onSaveFact}
            />
            <EntriesSection
                title={t("sections.services")}
                entries={p.services}
                evidence={p.evidence}
                canEdit={p.canEdit}
                onSave={onSaveFact}
            />
            <EntriesSection
                title={t("sections.projects")}
                entries={p.projects}
                evidence={p.evidence}
                canEdit={p.canEdit}
                onSave={onSaveFact}
            />
            <EntriesSection
                title={t("sections.agreements")}
                entries={p.legal}
                evidence={p.evidence}
                canEdit={p.canEdit}
                onSave={onSaveFact}
            />

            {p.evidence.length > 0 && (
                <section aria-label={t("sections.evidence")}>
                    <SectionHeading
                        title={t("sections.evidence")}
                        aside={t("sections.evidenceAside", { count: p.evidence.length })}
                    />
                    <EvidenceRows evidence={p.evidence} />
                </section>
            )}

            {sources}
        </>
    );
}

function hasChips(p: CompanyProfileDto): boolean {
    return (
        p.applicantType !== null ||
        p.focusAreas.length > 0 ||
        p.geography.length > 0 ||
        p.markets.length > 0
    );
}

/**
 * Read, and nothing proven: the real case of a workspace whose sources are
 * someone else's paper and a few empty mindmaps. It says so plainly and
 * points at the list of what was set aside, which sits right below it.
 */
function NothingProven({ profile: p }: { profile: CompanyProfileDto }) {
    const t = useTranslations("companyProfile");
    const locale = useLocale();
    const counted = p.sources.filter(s => s.counted).length;
    const reading = p.sources.filter(s => !s.counted && s.status === "pending").length;
    const aside = p.sources.length - counted - reading;

    const read: string[] = [];
    if (aside > 0 && counted === 0) {
        read.push(
            aside === 1
                ? t("nothingProven.oneAside")
                : t("nothingProven.allAside", { count: aside })
        );
    } else if (aside > 0) {
        read.push(t("nothingProven.someAside", { count: aside }));
    }
    if (counted > 0) read.push(t("nothingProven.countedNothing", { count: counted }));
    if (reading > 0) read.push(t("nothingProven.stillReading", { count: reading }));

    return (
        <section
            aria-label={t("nothingProven.label")}
            className="border-line bg-panel flex flex-col gap-2 rounded-lg border px-5 py-5"
        >
            <h2 className="text-ink text-sm font-medium">
                {counted > 0
                    ? t("nothingProven.titleCounted", { name: p.name })
                    : t("nothingProven.titleNone", { name: p.name })}
            </h2>
            <p className="text-ink-2 max-w-[62ch] text-sm">
                {sentences(locale, [t("nothingProven.keepsOnly", { name: p.name }), ...read])}
            </p>
            <p className="text-ink-2 max-w-[62ch] text-sm">
                {sentences(locale, [
                    t("nothingProven.addSomething", { name: p.name }),
                    ...(p.canEdit ? [t("nothingProven.countIt")] : []),
                ])}
            </p>
            {p.canEdit && (
                <div className="mt-1">
                    <SetupLink>{t("view.tellUs", { name: p.name })}</SetupLink>
                </div>
            )}
        </section>
    );
}
