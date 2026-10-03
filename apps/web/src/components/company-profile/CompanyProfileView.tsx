"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { EvidenceRows, Cite } from "~/components/tools/Cite";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonBlock, SkeletonRows } from "~/components/tools/SkeletonRows";
import { companyProfileApi } from "~/lib/company-profile/api";
import type {
    CompanyProfileDto,
    ProfileFactPatch,
    ProfileSourceDto,
    SourceOverride,
} from "~/lib/company-profile/dto";
import { plural, relativeTime } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";
import { cn } from "~/lib/utils";

import { EntriesSection, FactsSection } from "./FactsSection";
import { SourcesSection } from "./SourcesSection";
import { APPLICANT_WORD } from "./words";

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

function errorMessage(e: unknown, fallback: string): string {
    return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * The company profile: what the workspace's sources can prove about the
 * company, fact by fact, each with the excerpt that proves it — and which
 * sources it was read from and which it set aside, and why. Settings ›
 * Company and Proposals › Profile both render this, over one store.
 */
export function CompanyProfileView({ variant, onActions }: CompanyProfileViewProps) {
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
            toast.error(errorMessage(e, "Could not start reading your sources"));
        } finally {
            setStarting(false);
        }
    }, [take]);

    const saveFact = useCallback(
        async (patch: ProfileFactPatch) => {
            try {
                const { profile } = await companyProfileApi.patchFact(patch);
                take(profile);
                toast.success(
                    patch.reset
                        ? "Back to what the sources say"
                        : patch.value.trim()
                          ? "Saved"
                          : "Removed"
                );
            } catch (e) {
                toast.error(errorMessage(e, "Could not save that"));
                throw e;
            }
        },
        [take]
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
                toast.error(errorMessage(e, "Could not change that source"));
            } finally {
                setBusySource(null);
            }
        },
        [take]
    );

    const rebuildLabel = building
        ? "Reading sources…"
        : p?.status === "ready" || p?.status === "failed"
          ? "Rebuild profile"
          : "Build profile";
    const rebuildDisabled = !p || building || !hasSources;

    // In Settings the hub's chrome owns the action area — but it hides
    // actions from anyone without settings.manage, and anyone may rebuild.
    // So the chrome gets Rebuild only for an editor; a viewer gets it here.
    const chromeOwnsRebuild = variant === "settings" && !!onActions && p?.canEdit !== false;
    useEffect(() => {
        if (!chromeOwnsRebuild || !onActions) return;
        onActions({
            primaryLabel: rebuildLabel,
            primaryBusyLabel: "Reading sources…",
            onPrimary: () => void rebuild(),
            // The hub reads `busy ?? disabled`; leave busy unset unless it is.
            busy: building ? true : undefined,
            disabled: rebuildDisabled,
        });
        return () => onActions(null);
    }, [chromeOwnsRebuild, onActions, rebuildLabel, rebuild, building, rebuildDisabled]);

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
          ? "Reading your sources now"
          : p.status === "ready"
            ? `${plural(p.facts.length, "fact")} from ${plural(p.counts.counted, "source")} · built ${relativeTime(p.builtAt)}`
            : p.status === "failed"
              ? "The last build failed"
              : hasSources
                ? `${plural(p.counts.sources, "source")} in the workspace to read from`
                : "No sources yet";

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
                    title="What your sources"
                    accent="can prove"
                    sub={<span aria-live="polite">{sub}</span>}
                    actions={rebuildButton}
                />
            ) : (
                <div className="@max-md:flex-col @max-md:items-start flex items-center justify-between gap-3">
                    <p className="text-ink-3 text-[13px]" aria-live="polite">
                        {sub ?? " "}
                    </p>
                    {!chromeOwnsRebuild && rebuildButton}
                </div>
            )}

            {p && !p.canEdit && (
                <p className="text-ink-3 -mt-4 text-xs">
                    You can read this profile and rebuild it. An admin can edit its facts and decide
                    which sources count.
                </p>
            )}

            {res.error && <InlineError message={res.error} onRetry={() => void reload()} />}

            {p?.status === "failed" && !building && (
                <InlineError
                    message={p.error ?? "The last build failed."}
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

function StaleBanner({ onRebuild, disabled }: { onRebuild: () => void; disabled: boolean }) {
    return (
        <div
            role="status"
            className="border-line bg-panel-2 @max-md:flex-col @max-md:items-start flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
        >
            <p className="text-ink-2 text-[13px]">
                Out of date: a source or a decision about one changed since this was built, so a
                rebuild would read differently.
            </p>
            <Button size="sm" variant="outline" onClick={onRebuild} disabled={disabled}>
                Rebuild
            </Button>
        </div>
    );
}

function Chip({ children }: { children: ReactNode }) {
    return (
        <li className="border-line text-ink-2 inline-flex h-[22px] items-center rounded-full border px-2.5 text-[11.5px]">
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
    if (loading || !p) {
        if (!loading) return null; // a failed first load: the error above says so
        return (
            <div className="flex flex-col gap-7" aria-busy="true" aria-label="Loading the profile">
                <SkeletonBlock lines={3} />
                <SkeletonRows rows={5} height={56} />
            </div>
        );
    }

    if (!hasSources) {
        return (
            <EmptyState
                title="Nothing to read yet"
                body={`The profile is built from what your sources say about ${p.name}: past proposals, annual reports, a pitch deck, your website. Add a few to Sources, then build it here.`}
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
                        <p className="text-ink-2 text-sm">
                            Reading your sources now. Facts appear as soon as each source has been
                            read; this page updates itself.
                        </p>
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
                        title="No profile yet"
                        body={`Reads your ${plural(p.counts.sources, "source")} — past proposals, reports, your website — and keeps the facts about ${p.name} a writer needs at hand, each with the excerpt that proves it.`}
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
                <section aria-label="Summary">
                    {p.summary && (
                        <p className="text-ink max-w-[70ch] text-[14px] leading-relaxed">
                            {p.summary}
                            {p.summaryCites.map(n => (
                                <Cite key={n} n={n} evidence={p.evidence} />
                            ))}
                        </p>
                    )}
                    {hasChips(p) && (
                        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="At a glance">
                            {p.applicantType && <Chip>{APPLICANT_WORD[p.applicantType]}</Chip>}
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
                title="People"
                entries={p.people}
                evidence={p.evidence}
                canEdit={p.canEdit}
                onSave={onSaveFact}
            />
            <EntriesSection
                title="Products & services"
                entries={p.services}
                evidence={p.evidence}
                canEdit={p.canEdit}
                onSave={onSaveFact}
            />
            <EntriesSection
                title="Projects"
                entries={p.projects}
                evidence={p.evidence}
                canEdit={p.canEdit}
                onSave={onSaveFact}
            />

            {p.evidence.length > 0 && (
                <section aria-label="Evidence">
                    <SectionHeading
                        title="Evidence"
                        aside={`${plural(p.evidence.length, "excerpt")} the profile cites`}
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
    const counted = p.sources.filter(s => s.counted).length;
    const reading = p.sources.filter(s => !s.counted && s.status === "pending").length;
    const aside = p.sources.length - counted - reading;

    const read: string[] = [];
    if (aside > 0 && counted === 0) {
        read.push(
            aside === 1
                ? "Your one source was read and set aside; it says why below."
                : `All ${aside} of your sources were read and set aside; each says why below.`
        );
    } else if (aside > 0) {
        read.push(`${plural(aside, "source")} set aside; each says why below.`);
    }
    if (counted > 0) {
        read.push(
            `${plural(counted, "source")} counted, but nothing in ${counted === 1 ? "it" : "them"} could be proven yet.`
        );
    }
    if (reading > 0) read.push(`${plural(reading, "source")} still being read.`);

    return (
        <section
            aria-label="Nothing proven yet"
            className="border-line bg-panel flex flex-col gap-2 rounded-lg border px-5 py-5"
        >
            <h2 className="text-ink text-sm font-medium">
                {counted > 0
                    ? `Nothing about ${p.name} could be proven yet`
                    : `None of your sources is about ${p.name} yet`}
            </h2>
            <p className="text-ink-2 max-w-[62ch] text-sm">
                The profile keeps only what a source written by or about {p.name} says, each fact
                with the excerpt that proves it. {read.join(" ")}
            </p>
            <p className="text-ink-2 max-w-[62ch] text-sm">
                Add something about {p.name} — a pitch deck, a past proposal, an annual report, your
                website — and rebuild.
                {p.canEdit && " If a source below is about you after all, count it."}
            </p>
        </section>
    );
}
