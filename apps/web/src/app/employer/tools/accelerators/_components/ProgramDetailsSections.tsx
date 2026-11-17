"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import type { TagFacet } from "@launchstack/pipelines/accelerators/intelligence";

import MarkdownMessage from "~/app/_components/MarkdownMessage";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { cn } from "~/lib/utils";

import type { ProgramView, TrackerOpportunity } from "../api";
import { useAccelerators } from "../_lib/context";
import {
    facetValues,
    publishedValue,
    hasRollingIntake,
    type DetailSlot,
    type DetailSource,
    type ProgramDetails,
} from "../_lib/details";
import {
    DEFAULT_VISION_FILTERS,
    applyVisionFilters,
    daysBetween,
    updateVisionParams,
    type VisionFilters,
} from "../_lib/vision-filters";
import { FacetLink } from "./FacetLink";
import { LinkList, linkItem, pageLabel, type LinkListItem } from "./LinkList";
import { ProgramLogo } from "./ProgramFacts";
import { RegionMap } from "./RegionMap";

/** One entry per page; several excerpts from the same page are one source. */
function uniqueSources(sources: readonly DetailSource[]): DetailSource[] {
    const byUrl = new Map<string, DetailSource>();
    for (const source of sources) {
        const seen = byUrl.get(source.url);
        if (!seen || source.checkedAt > seen.checkedAt) byUrl.set(source.url, source);
    }
    return [...byUrl.values()];
}

/** A readable page title: the scraper's "Name — application page checked by …" becomes "Application page". */
function sourceTitle(source: DetailSource): string {
    const generated = /^.+? — (.+?) checked by \S+$/.exec(source.title);
    const title = generated ? generated[1]! : source.title;
    return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * Every page the Program's facts come from, once each, newest check first;
 * folded under its count until asked for, so the facts above stay the page.
 */
function SourceList({ sources }: { sources: readonly DetailSource[] }) {
    const t = useTranslations("accelerators.details");
    const format = useFormatter();
    const unique = uniqueSources(sources).sort((left, right) =>
        right.checkedAt.localeCompare(left.checkedAt)
    );
    if (unique.length === 0) return null;
    return (
        <Collapsible asChild>
            <section className="border-line space-y-3 border-t pt-4">
                <h3 className="text-sm">
                    <CollapsibleTrigger className="focus-visible:ring-brand/50 group flex w-full items-center gap-2 rounded text-left outline-none focus-visible:ring-2">
                        <span className="text-ink font-semibold">
                            {t("sourcesCount", { count: unique.length })}
                        </span>
                        <span className="text-ink-3 text-xs">
                            {t("checked", {
                                date: format.dateTime(new Date(unique[0]!.checkedAt), {
                                    dateStyle: "medium",
                                }),
                            })}
                        </span>
                        <ChevronDown className="text-ink-3 ml-auto size-4 transition-transform group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                </h3>
                <CollapsibleContent>
                    <LinkList
                        items={unique.map(source => ({
                            href: source.url,
                            title: sourceTitle(source),
                            detail: pageLabel(source.url),
                            meta: t("checked", {
                                date: format.dateTime(new Date(source.checkedAt), {
                                    dateStyle: "medium",
                                }),
                            }),
                        }))}
                    />
                </CollapsibleContent>
            </section>
        </Collapsible>
    );
}

/** A missing value is never replaced with catalogue boilerplate or a guessed fact. */
function Slot<T>({
    slot,
    render,
}: {
    slot: DetailSlot<T> | undefined;
    render?: (value: T) => ReactNode;
}) {
    const t = useTranslations("accelerators.details");
    const value = publishedValue(slot);
    return (
        <span className="whitespace-pre-wrap break-words">
            {value === null
                ? t(!slot || slot.state === "not_checked" ? "notChecked" : "unknown")
                : render
                  ? render(value)
                  : Array.isArray(value)
                    ? value.join(" · ")
                    : String(value)}
        </span>
    );
}

/** Public email and phone on one line; "Not published" once when neither was found. */
function contactLine(details: ProgramDetails | undefined): string | null {
    const parts = [
        publishedValue(details?.contact.email),
        publishedValue(details?.contact.phone),
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Collected narratives can open with how they were written ("AI-written interpretation of
 * the flagship page, prepared by …:"). The interpretation badge carries that; the reader
 * gets the narrative itself.
 */
function readableNarrative(text: string): string {
    const body = text.replace(/^AI-written (?:synthesis|interpretation)\b[^:]*:\s*/i, "");
    return body.charAt(0).toUpperCase() + body.slice(1);
}

/** "up to USD 150000" reads as "Up to $150,000" in the reader's language and locale. */
function useFormatCash(): (value: string) => string {
    const t = useTranslations("accelerators.details");
    const format = useFormatter();
    return value => {
        const match = /^(up to )?([A-Z]{3}) (\d+)$/i.exec(value);
        if (!match) return value;
        const [, upTo, currency, amount] = match;
        const money = format.number(Number(amount), {
            style: "currency",
            currency: currency!.toUpperCase(),
            maximumFractionDigits: 0,
        });
        return upTo ? t("upTo", { amount: money }) : money;
    };
}

/** "Under 2%" or "About 7.5%" when the page qualified the figure; the bare percentage otherwise. */
function useFormatRate(): (value: {
    rate: number;
    qualifier?: "under" | "about" | "over";
}) => string {
    const t = useTranslations("accelerators.details");
    const format = useFormatter();
    return ({ rate, qualifier }) => {
        const percent = format.number(rate, { style: "percent", maximumFractionDigits: 2 });
        return qualifier ? t(`rate.${qualifier}`, { rate: percent }) : percent;
    };
}

function Fact({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
    return (
        <div className={wide ? "col-span-full min-w-0 space-y-1.5" : "min-w-0 space-y-0.5"}>
            <dt className="text-ink-3 text-xs">{label}</dt>
            <dd className="text-ink text-sm leading-relaxed">{children}</dd>
        </div>
    );
}

type FactItem = {
    label: string;
    state: "known" | "unpublished" | "unchecked";
    node: ReactNode;
    /** Spans the whole list, for content such as a list of links. */
    wide?: boolean;
};

function fact<T>(
    label: string,
    slot: DetailSlot<T> | undefined,
    render?: (value: T) => ReactNode
): FactItem {
    const value = publishedValue(slot);
    const known = value !== null && !(Array.isArray(value) && value.length === 0);
    return {
        label,
        state: known ? "known" : slot && slot.state !== "not_checked" ? "unpublished" : "unchecked",
        node: <Slot slot={slot} render={render} />,
    };
}

/**
 * Every published way to apply as one list of titled links: the application portal
 * first, then the other application pages and addresses the scraper found.
 */
function howToApply(label: string, details: ProgramDetails | undefined): FactItem {
    const portal = publishedValue(details?.contact.applicationUrl);
    const routes = publishedValue(details?.contact.routes) ?? [];
    const links = new Map<string, LinkListItem>();
    for (const value of portal ? [portal, ...routes] : routes) {
        const item = linkItem(value);
        if (item && !links.has(item.href)) links.set(item.href, item);
    }
    if (links.size === 0) return fact(label, details?.contact.routes);
    return { label, state: "known", wide: true, node: <LinkList items={[...links.values()]} /> };
}

/**
 * Known facts as a plain list. Facts the pages did not publish, or that were not
 * checked yet, collapse into one quiet line each instead of a field per gap.
 */
function FactList({ items }: { items: FactItem[] }) {
    const t = useTranslations("accelerators.details");
    const format = useFormatter();
    const known = items.filter(item => item.state === "known");
    const missing = (state: FactItem["state"]) =>
        format.list(items.filter(item => item.state === state).map(item => item.label));
    const unpublished = items.some(item => item.state === "unpublished");
    const unchecked = items.some(item => item.state === "unchecked");
    return (
        <div className="space-y-3">
            {known.length > 0 && (
                <dl className="grid gap-x-6 gap-y-3 [@container(min-width:560px)]:grid-cols-2">
                    {known.map(item => (
                        <Fact key={item.label} label={item.label} wide={item.wide}>
                            {item.node}
                        </Fact>
                    ))}
                </dl>
            )}
            {unpublished && (
                <p className="text-ink-3 text-xs">
                    {t("notPublishedList", { fields: missing("unpublished") })}
                </p>
            )}
            {unchecked && (
                <p className="text-ink-3 text-xs">
                    {t("notCheckedList", { fields: missing("unchecked") })}
                </p>
            )}
        </div>
    );
}

export function ProgramHero({
    view,
    details,
    deadline,
    today,
    tracked,
    mobileScore,
}: {
    view: ProgramView;
    details: ProgramDetails | undefined;
    deadline: string | null;
    today: string;
    tracked: TrackerOpportunity | undefined;
    mobileScore: ReactNode;
}) {
    const t = useTranslations("accelerators");
    const format = useFormatter();
    const formatRate = useFormatRate();
    const program = view.program;
    const applicationUrl = publishedValue(details?.contact.applicationUrl);
    const status = publishedValue(details?.identity.operatingStatus);
    const selectivity = publishedValue(details?.selectivity);
    const location = publishedValue(details?.identity.location);
    const stages = publishedValue(details?.audience.stages) ?? [];
    const meta = [
        location,
        stages.length > 0 ? stages.join(" – ") : null,
        status && status !== "active" ? t(`details.operatingStatus.${status}`) : null,
        tracked ? t(`tracker.statuses.${tracked.status}`) : null,
    ].filter(Boolean);
    const formatCash = useFormatCash();
    const cash = publishedValue(details?.deal.cash)?.map(formatCash);
    const equity = publishedValue(details?.deal.equity);
    const keyFacts = [
        cash?.length ? { label: t("details.cash"), value: cash.join(" · ") } : null,
        equity?.length ? { label: t("details.fixedEquity"), value: equity.join(" · ") } : null,
        deadline
            ? {
                  label: t("details.nextDeadline"),
                  value: `${format.dateTime(new Date(`${deadline}T00:00:00Z`), {
                      dateStyle: "medium",
                      timeZone: "UTC",
                  })} · ${t("details.inDays", { days: daysBetween(today, deadline) })}`,
              }
            : hasRollingIntake(details)
              ? { label: t("details.nextDeadline"), value: t("details.rolling") }
              : null,
        selectivity?.rate != null
            ? {
                  label: t("details.selectivity"),
                  value: formatRate({ rate: selectivity.rate, qualifier: selectivity.qualifier }),
              }
            : null,
    ].filter((item): item is NonNullable<typeof item> => item !== null);
    return (
        <header className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
                <ProgramLogo program={program} size="md" />
                <div className="min-w-0 flex-1">
                    <h1 className="display text-ink break-words text-2xl tracking-tight">
                        {program.name}
                    </h1>
                    {meta.length > 0 && <p className="text-ink-3 text-sm">{meta.join(" · ")}</p>}
                </div>
                <div className="shrink-0 [@container(min-width:860px)]:hidden">{mobileScore}</div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="ghost" size="sm">
                        <a href={program.websiteUrl} target="_blank" rel="noopener noreferrer">
                            {t("common.website")}
                            <ExternalLink className="size-3.5" />
                        </a>
                    </Button>
                    {applicationUrl && (
                        <Button asChild size="sm">
                            <a href={applicationUrl} target="_blank" rel="noopener noreferrer">
                                {t("common.portal")}
                                <ExternalLink className="size-3.5" />
                            </a>
                        </Button>
                    )}
                </div>
            </div>
            {keyFacts.length > 0 && (
                <dl className="flex flex-wrap gap-x-8 gap-y-2">
                    {keyFacts.map(item => (
                        <Fact key={item.label} label={item.label}>
                            {item.value}
                        </Fact>
                    ))}
                </dl>
            )}
        </header>
    );
}

/** Long enough that the full narrative would push the facts below the fold. */
const NARRATIVE_CLAMP = 320;

/** Who the Program is for: the first lines, the rest on request. */
function AudienceNarrative({ details }: { details: ProgramDetails | undefined }) {
    const t = useTranslations("accelerators.overview");
    const [expanded, setExpanded] = useState(false);
    const text = publishedValue(details?.audience.narrative);
    const long = (text?.length ?? 0) > NARRATIVE_CLAMP;
    return (
        <div className="space-y-1">
            <div
                className={cn(
                    "text-ink-2 text-sm leading-relaxed",
                    long && !expanded && "line-clamp-4"
                )}
            >
                <Slot slot={details?.audience.narrative} render={readableNarrative} />
            </div>
            {long && (
                <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpanded(open => !open)}
                    className="text-brand-ink focus-visible:ring-brand/50 rounded text-xs font-medium outline-none hover:underline focus-visible:ring-2"
                >
                    {expanded ? t("readLess") : t("readMore")}
                </button>
            )}
        </div>
    );
}

/**
 * Who the Program is for, where it invests (on a map), and what it backs. Each
 * published value links to the other Programs that share it, with how many.
 */
export function OverviewTab({
    details,
}: {
    view: ProgramView;
    details: ProgramDetails | undefined;
}) {
    const t = useTranslations("accelerators");
    const { home } = useAccelerators();
    const today = new Date().toISOString().slice(0, 10);
    // What the Programs list would show with only this filter: the counts match the
    // list each link opens, ineligible Programs left out as the list leaves them out.
    const countFor = (patch: Partial<VisionFilters>) =>
        home
            ? applyVisionFilters(
                  home.programs,
                  { ...DEFAULT_VISION_FILTERS, ...patch },
                  { details: home.details, tracker: [], today }
              ).length
            : 0;
    const hrefFor = (patch: Partial<VisionFilters>) =>
        `/programs?${updateVisionParams(new URLSearchParams(), patch).toString()}`;
    const linked = (
        label: string,
        slot: DetailSlot<string[]> | undefined,
        facet: TagFacet,
        filter: (id: string) => Partial<VisionFilters>
    ): FactItem => {
        const item = fact(label, slot);
        const values = publishedValue(slot);
        if (item.state !== "known" || !values) return item;
        return {
            ...item,
            node: (
                <ul className="flex flex-wrap gap-1.5 pt-1">
                    {facetValues(details, facet, values).map(value => (
                        <li key={value.id} className="min-w-0">
                            <FacetLink
                                href={hrefFor(filter(value.id))}
                                label={value.label}
                                count={countFor(filter(value.id))}
                            />
                        </li>
                    ))}
                </ul>
            ),
        };
    };
    const regions = fact(t("details.regions"), details?.audience.geography);
    const regionValues = publishedValue(details?.audience.geography);
    return (
        <div className="space-y-8">
            <section className="space-y-2">
                <h3 className="text-ink text-sm font-semibold">{t("program.targetApplicants")}</h3>
                <AudienceNarrative details={details} />
            </section>
            <FactList
                items={[
                    regions.state === "known" && regionValues
                        ? {
                              ...regions,
                              wide: true,
                              node: (
                                  <div className="pt-1">
                                      <RegionMap
                                          regions={facetValues(
                                              details,
                                              "geography",
                                              regionValues
                                          ).map(value => ({
                                              ...value,
                                              count: countFor({ region: value.id }),
                                              href: hrefFor({ region: value.id }),
                                          }))}
                                      />
                                  </div>
                              ),
                          }
                        : regions,
                    linked(t("vision.stage"), details?.audience.stages, "stage", id => ({
                        stage: id,
                    })),
                    linked(t("vision.sectors"), details?.audience.sectors, "sector", id => ({
                        sectors: [id],
                    })),
                    linked(
                        t("details.technologies"),
                        details?.audience.technologies,
                        "technology",
                        id => ({ technology: id })
                    ),
                    linked(
                        t("details.businessModels"),
                        details?.audience.businessModels,
                        "business_model",
                        id => ({ businessModel: id })
                    ),
                    linked(
                        t("details.customerTypes"),
                        details?.audience.customerTypes,
                        "customer_type",
                        id => ({ customerType: id })
                    ),
                    linked(t("details.benefits"), details?.deal.benefits, "benefit", id => ({
                        benefit: id,
                    })),
                    fact(t("details.constraints"), details?.audience.constraints),
                    fact(t("details.portfolio"), details?.portfolio, value =>
                        t("details.portfolioCount", { count: value })
                    ),
                    contactLine(details)
                        ? {
                              label: t("details.contact"),
                              state: "known",
                              node: contactLine(details),
                          }
                        : fact(t("details.contact"), details?.contact.email),
                ]}
            />
            <SourceList sources={details?.sources ?? []} />
        </div>
    );
}

export function DealTab({ details }: { details: ProgramDetails | undefined }) {
    const t = useTranslations("accelerators.details");
    const formatCash = useFormatCash();
    const summary = publishedValue(details?.deal.summary);
    const wording = publishedValue(details?.deal.formatted);
    return (
        <div className="space-y-4">
            {summary && <p className="text-ink text-base font-semibold">{summary}</p>}
            <FactList
                items={[
                    fact(t("cash"), details?.deal.cash, values =>
                        values.map(formatCash).join(" · ")
                    ),
                    fact(t("fixedEquity"), details?.deal.equity),
                    fact(t("instrument"), details?.deal.instrument),
                    fact(t("comparable"), details?.deal.comparable, value =>
                        t(value ? "comparableYes" : "comparableNo")
                    ),
                    fact(t("benefits"), details?.deal.benefits),
                ]}
            />
            {wording && (
                <section className="space-y-2">
                    <h3 className="text-ink text-sm font-semibold">{t("inTheirWords")}</h3>
                    <blockquote className="border-line border-l-2 pl-4">
                        <MarkdownMessage
                            content={wording}
                            className="text-ink-2 space-y-3 text-sm leading-relaxed [&_h2]:mt-4 [&_h2]:font-semibold [&_h3]:font-medium"
                        />
                    </blockquote>
                </section>
            )}
        </div>
    );
}

export function ApplyingTab({
    details,
    today,
}: {
    view: ProgramView;
    details: ProgramDetails | undefined;
    today: string;
}) {
    const t = useTranslations("accelerators");
    const format = useFormatter();
    const formatRate = useFormatRate();
    return (
        <div className="space-y-5">
            {details?.batches.cycles.length ? (
                <ol className="divide-line divide-y">
                    {details.batches.cycles.map(cycle => (
                        <li
                            key={cycle.id}
                            className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0"
                        >
                            <span className="text-ink text-sm font-medium">{cycle.label}</span>
                            <span className="text-ink-2 text-sm">
                                <Slot
                                    slot={cycle.announcedDeadline}
                                    render={value => {
                                        const date = value.dateOnly ?? value.at?.slice(0, 10);
                                        return date ? (
                                            <>
                                                {format.dateTime(new Date(`${date}T00:00:00Z`), {
                                                    dateStyle: "long",
                                                    timeZone: "UTC",
                                                })}
                                                {date >= today && (
                                                    <span className="text-ink-3">
                                                        {" "}
                                                        ·{" "}
                                                        {t("details.inDays", {
                                                            days: daysBetween(today, date),
                                                        })}
                                                    </span>
                                                )}
                                            </>
                                        ) : value.rolling ? (
                                            t("details.rolling")
                                        ) : (
                                            t("details.unknown")
                                        );
                                    }}
                                />
                            </span>
                        </li>
                    ))}
                </ol>
            ) : null}
            <FactList
                items={[
                    howToApply(t("details.howToApply"), details),
                    fact(t("details.cadence"), details?.batches.historicalCadence),
                    // Start dates are published as a schedule, one line per cohort.
                    {
                        ...fact(t("details.announcedStarts"), details?.batches.announcedStarts),
                        wide: true,
                    },
                    fact(t("details.nextDeadline"), details?.batches.nextDeadline),
                    fact(t("details.residencyEnd"), details?.batches.residencyEnd),
                    fact(
                        t("details.selectivity"),
                        details?.selectivity,
                        value =>
                            [
                                value.rate !== null
                                    ? formatRate({ rate: value.rate, qualifier: value.qualifier })
                                    : null,
                                value.population,
                                value.method,
                            ]
                                .filter(Boolean)
                                .join(" · ") || t("details.unknown")
                    ),
                ]}
            />
            <p className="text-ink-3 text-xs">{t("program.portalNote")}</p>
        </div>
    );
}
