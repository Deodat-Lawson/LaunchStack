"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";

import type { TagFacet } from "@launchstack/pipelines/accelerators/intelligence";

import { facetOptions, knowsFacet, publishedValue, type ProgramDetailsMap } from "../_lib/details";
import {
    FIT_FILTERS,
    INTAKE_FILTERS,
    MINIMUM_SCORES,
    type DiscoveryFilters,
} from "../_lib/discovery";
import {
    DEADLINE_WINDOWS,
    DEAL_FILTERS,
    PRIORITY_FILTERS,
    SORTS,
    type VisionFilters,
} from "../_lib/vision-filters";

const CHIP = "h-8 w-auto gap-1.5 rounded-full px-3 text-xs";
const VIEWS = ["any", "tracked", "pending", "untracked"] as const;

/**
 * Options with how many Programs each would show alongside the other filters. Options
 * that would show none are left out, except the one already chosen; "any" has no count.
 */
function counted<T extends string>(
    options: readonly T[],
    value: T,
    count?: (option: T) => number | null
): { option: T; count: number | null }[] {
    const rows = options.map(option => ({ option, count: count ? count(option) : null }));
    return rows.filter(row => row.option === value || row.count === null || row.count > 0);
}

function OptionLabel({ label, count }: { label: string; count: number | null }) {
    const format = useFormatter();
    return (
        <span className="flex w-full items-center justify-between gap-3">
            <span className="truncate">{label}</span>
            {count !== null && (
                <span className="text-ink-3 tabular-nums">{format.number(count)}</span>
            )}
        </span>
    );
}

function ChipSelect<T extends string>({
    value,
    options,
    optionLabel,
    count,
    onChange,
    ariaLabel,
    active,
}: {
    value: T;
    options: readonly T[];
    optionLabel: (option: T) => string;
    count?: (option: T) => number | null;
    onChange: (value: T) => void;
    ariaLabel: string;
    active: boolean;
}) {
    return (
        <Select value={value} onValueChange={next => onChange(next as T)}>
            <SelectTrigger
                size="sm"
                aria-label={ariaLabel}
                className={`${CHIP} ${active ? "border-brand/50 bg-brand-soft text-brand-ink" : ""}`}
            >
                <SelectValue>{optionLabel(value)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
                {counted(options, value, count).map(row => (
                    <SelectItem key={row.option} value={row.option}>
                        <OptionLabel label={optionLabel(row.option)} count={row.count} />
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function Field({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: (id: string) => ReactNode;
}) {
    const id = useId();
    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={id} className="text-ink-2 text-xs">
                    {label}
                </Label>
                {hint && <span className="text-ink-3 text-xs">{hint}</span>}
            </div>
            {children(id)}
        </div>
    );
}

function FieldSelect<T extends string>({
    id,
    value,
    options,
    optionLabel,
    count,
    onChange,
}: {
    id: string;
    value: T;
    options: readonly T[];
    optionLabel: (option: T) => string;
    count?: (option: T) => number | null;
    onChange: (value: T) => void;
}) {
    return (
        <Select value={value} onValueChange={next => onChange(next as T)}>
            <SelectTrigger id={id} size="sm">
                <SelectValue>{optionLabel(value)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
                {counted(options, value, count).map(row => (
                    <SelectItem key={row.option} value={row.option}>
                        <OptionLabel label={optionLabel(row.option)} count={row.count} />
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

/**
 * Search, one Filters panel and sort on a single row, with the result count and the
 * active filters (each removable) on one quiet line beneath.
 */
export function DiscoveryToolbar({
    catalogue,
    vision,
    details,
    resultCount,
    totalCount,
    countVision,
    countCatalogue,
    onCatalogue,
    onVision,
    onReset,
}: {
    catalogue: DiscoveryFilters;
    vision: VisionFilters;
    details: ProgramDetailsMap;
    resultCount: number;
    totalCount: number;
    /** How many Programs would show with this change to the facet filters. */
    countVision: (patch: Partial<VisionFilters>) => number;
    /** How many Programs would show with this change to the saved-fit and intake filters. */
    countCatalogue: (patch: Partial<DiscoveryFilters>) => number;
    onCatalogue: (patch: Partial<DiscoveryFilters>) => void;
    onVision: (patch: Partial<VisionFilters>) => void;
    onReset: () => void;
}) {
    const t = useTranslations("accelerators");
    const format = useFormatter();
    const sectors = facetOptions(details, ["sector"]);
    const stages = facetOptions(details, ["stage"]);
    const regions = facetOptions(details, ["geography"]);
    const labelFor = (options: { id: string; label: string }[], id: string) =>
        options.find(option => option.id === id)?.label ?? id;
    const sectorLabel = (sector: string) => labelFor(sectors, sector);
    const minScoreValue = catalogue.minScore === null ? "any" : String(catalogue.minScore);
    const all = Object.values(details);
    /** "Known for 171 of 255": how much of the Catalogue a facet can filter at all. */
    const knownHint = (facet: TagFacet) =>
        t("vision.knownFor", {
            count: all.filter(item => knowsFacet(item, facet)).length,
            total: totalCount,
        });
    const visionCount =
        <K extends keyof VisionFilters>(key: K, none: VisionFilters[K]) =>
        (option: VisionFilters[K]) =>
            option === none ? null : countVision({ [key]: option } as Partial<VisionFilters>);
    const advanced = [
        vision.deal !== "any",
        vision.region !== "any",
        vision.priority !== "any",
        catalogue.fit !== "all",
        catalogue.minScore !== null,
        catalogue.intake !== "all",
        vision.includeIneligible,
        ...[
            vision.technology,
            vision.businessModel,
            vision.customerType,
            vision.instrument,
            vision.benefit,
        ].map(value => value !== "any"),
    ].filter(Boolean).length;

    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (catalogue.q.trim()) {
        chips.push({
            key: "q",
            label: `“${catalogue.q.trim()}”`,
            clear: () => onCatalogue({ q: "" }),
        });
    }
    for (const sector of vision.sectors) {
        chips.push({
            key: `sector-${sector}`,
            label: sectorLabel(sector),
            clear: () => onVision({ sectors: vision.sectors.filter(item => item !== sector) }),
        });
    }
    if (vision.stage !== "any") {
        chips.push({
            key: "stage",
            label: labelFor(stages, vision.stage),
            clear: () => onVision({ stage: "any" }),
        });
    }
    if (vision.deadline !== "any") {
        chips.push({
            key: "deadline",
            label: t(`vision.deadlineOptions.${vision.deadline}`),
            clear: () => onVision({ deadline: "any" }),
        });
    }
    if (vision.deal !== "any") {
        chips.push({
            key: "deal",
            label: t(`vision.dealOptions.${vision.deal}`),
            clear: () => onVision({ deal: "any" }),
        });
    }
    if (vision.region !== "any") {
        chips.push({
            key: "region",
            label: labelFor(regions, vision.region),
            clear: () => onVision({ region: "any" }),
        });
    }
    if (vision.priority !== "any") {
        chips.push({
            key: "priority",
            label: t("vision.priorityChip", {
                priority: t(`tracker.priorities.${vision.priority}`),
            }),
            clear: () => onVision({ priority: "any" }),
        });
    }
    if (catalogue.fit !== "all") {
        chips.push({
            key: "fit",
            label: t(`discovery.fitOptions.${catalogue.fit}`),
            clear: () => onCatalogue({ fit: "all" }),
        });
    }
    if (catalogue.minScore !== null) {
        chips.push({
            key: "minScore",
            label: t("discovery.minimumOption", { score: format.number(catalogue.minScore) }),
            clear: () => onCatalogue({ minScore: null }),
        });
    }
    if (catalogue.intake !== "all") {
        chips.push({
            key: "intake",
            label: t(`discovery.intakeOptions.${catalogue.intake}`),
            clear: () => onCatalogue({ intake: "all" }),
        });
    }
    if (vision.includeIneligible) {
        chips.push({
            key: "ineligible",
            label: t("vision.includeIneligible"),
            clear: () => onVision({ includeIneligible: false }),
        });
    }
    const taxonomyFacets = [
        { key: "technology", facet: "technology" },
        { key: "businessModel", facet: "business_model" },
        { key: "customerType", facet: "customer_type" },
        { key: "instrument", facet: "instrument" },
        { key: "benefit", facet: "benefit" },
    ] as const;
    for (const { key, facet } of taxonomyFacets) {
        if (vision[key] !== "any")
            chips.push({
                key,
                label: labelFor(facetOptions(details, [facet]), vision[key]),
                clear: () => onVision({ [key]: "any" }),
            });
    }
    if (vision.tracked !== "any") {
        chips.push({
            key: "tracked",
            label: t(`vision.trackedOptions.${vision.tracked}`),
            clear: () => onVision({ tracked: "any" }),
        });
    }

    const active =
        advanced +
        vision.sectors.length +
        [vision.stage !== "any", vision.deadline !== "any", vision.tracked !== "any"].filter(
            Boolean
        ).length;

    return (
        <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                    <Search className="text-ink-3 pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
                    <Input
                        type="search"
                        value={catalogue.q}
                        onChange={event => onCatalogue({ q: event.target.value })}
                        placeholder={t("discovery.searchPlaceholder")}
                        aria-label={t("discovery.search")}
                        className="h-8 rounded-full pl-9 text-sm"
                    />
                </div>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className={`${CHIP} ${active > 0 ? "border-brand/50 bg-brand-soft text-brand-ink" : ""}`}
                        >
                            <SlidersHorizontal className="size-3.5" />
                            {t("vision.filters")}
                            {active > 0 && <span className="tabular-nums">· {active}</span>}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        align="end"
                        className="max-h-[70vh] w-80 space-y-3 overflow-y-auto"
                    >
                        <Field label={t("vision.tracked")}>
                            {id => (
                                <FieldSelect
                                    id={id}
                                    value={VIEWS.find(value => value === vision.tracked) ?? "any"}
                                    options={VIEWS}
                                    optionLabel={option => t(`vision.trackedOptions.${option}`)}
                                    count={visionCount("tracked", "any")}
                                    onChange={tracked => onVision({ tracked })}
                                />
                            )}
                        </Field>
                        <div className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-2">
                                <p className="text-ink-2 text-xs">{t("vision.sectors")}</p>
                                <span className="text-ink-3 text-xs">{knownHint("sector")}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                                {sectors
                                    .map(({ id: sector }) => ({
                                        sector,
                                        count: countVision({ sectors: [sector] }),
                                    }))
                                    .filter(
                                        ({ sector, count }) =>
                                            count > 0 || vision.sectors.includes(sector)
                                    )
                                    .map(({ sector, count }) => {
                                        const id = `sector-${sector}`;
                                        return (
                                            <div key={sector} className="flex items-center gap-2">
                                                <Checkbox
                                                    id={id}
                                                    checked={vision.sectors.includes(sector)}
                                                    onCheckedChange={checked =>
                                                        onVision({
                                                            sectors:
                                                                checked === true
                                                                    ? [...vision.sectors, sector]
                                                                    : vision.sectors.filter(
                                                                          item => item !== sector
                                                                      ),
                                                        })
                                                    }
                                                />
                                                <Label
                                                    htmlFor={id}
                                                    className="text-ink-2 flex min-w-0 flex-1 justify-between gap-2 text-xs font-normal"
                                                >
                                                    <span className="truncate">
                                                        {sectorLabel(sector)}
                                                    </span>
                                                    <span className="text-ink-3 tabular-nums">
                                                        {format.number(count)}
                                                    </span>
                                                </Label>
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                        <Field label={t("vision.stage")} hint={knownHint("stage")}>
                            {id => (
                                <FieldSelect
                                    id={id}
                                    value={vision.stage}
                                    options={["any", ...stages.map(option => option.id)]}
                                    optionLabel={option =>
                                        option === "any"
                                            ? t("vision.anyStage")
                                            : labelFor(stages, option)
                                    }
                                    count={visionCount("stage", "any")}
                                    onChange={stage => onVision({ stage })}
                                />
                            )}
                        </Field>
                        <Field label={t("vision.deadline")}>
                            {id => (
                                <FieldSelect
                                    id={id}
                                    value={vision.deadline}
                                    options={DEADLINE_WINDOWS}
                                    optionLabel={option => t(`vision.deadlineOptions.${option}`)}
                                    count={visionCount("deadline", "any")}
                                    onChange={deadline => onVision({ deadline })}
                                />
                            )}
                        </Field>
                        <Field
                            label={t("vision.deal")}
                            hint={t("vision.knownFor", {
                                count: all.filter(
                                    item => (publishedValue(item.deal.equity)?.length ?? 0) > 0
                                ).length,
                                total: totalCount,
                            })}
                        >
                            {id => (
                                <FieldSelect
                                    id={id}
                                    value={vision.deal}
                                    options={DEAL_FILTERS}
                                    optionLabel={option => t(`vision.dealOptions.${option}`)}
                                    count={visionCount("deal", "any")}
                                    onChange={deal => onVision({ deal })}
                                />
                            )}
                        </Field>
                        {taxonomyFacets.map(({ key, facet }) => {
                            const options = facetOptions(details, [facet]);
                            return (
                                <Field key={key} label={t(`vision.${key}`)} hint={knownHint(facet)}>
                                    {id => (
                                        <FieldSelect
                                            id={id}
                                            value={vision[key]}
                                            options={["any", ...options.map(option => option.id)]}
                                            optionLabel={option =>
                                                option === "any"
                                                    ? t("vision.any")
                                                    : labelFor(options, option)
                                            }
                                            count={visionCount(key, "any")}
                                            onChange={value => onVision({ [key]: value })}
                                        />
                                    )}
                                </Field>
                            );
                        })}
                        <Field label={t("vision.region")} hint={knownHint("geography")}>
                            {id => (
                                <FieldSelect
                                    id={id}
                                    value={vision.region}
                                    options={["any", ...regions.map(option => option.id)]}
                                    optionLabel={option =>
                                        option === "any"
                                            ? t("vision.any")
                                            : labelFor(regions, option)
                                    }
                                    count={visionCount("region", "any")}
                                    onChange={region => onVision({ region })}
                                />
                            )}
                        </Field>
                        <Field label={t("vision.priority")}>
                            {id => (
                                <FieldSelect
                                    id={id}
                                    value={vision.priority}
                                    options={PRIORITY_FILTERS}
                                    optionLabel={option =>
                                        option === "any"
                                            ? t("vision.any")
                                            : t(`tracker.priorities.${option}`)
                                    }
                                    count={visionCount("priority", "any")}
                                    onChange={priority => onVision({ priority })}
                                />
                            )}
                        </Field>
                        <div className="border-line space-y-3 border-t pt-3">
                            <p className="text-ink-3 text-xs">{t("vision.aiMatchHint")}</p>
                            <Field label={t("discovery.fit")}>
                                {id => (
                                    <FieldSelect
                                        id={id}
                                        value={catalogue.fit}
                                        options={FIT_FILTERS}
                                        optionLabel={option => t(`discovery.fitOptions.${option}`)}
                                        count={option =>
                                            option === "all"
                                                ? null
                                                : countCatalogue({ fit: option })
                                        }
                                        onChange={fit => onCatalogue({ fit })}
                                    />
                                )}
                            </Field>
                            <Field label={t("discovery.minimumScore")}>
                                {id => (
                                    <FieldSelect
                                        id={id}
                                        value={minScoreValue}
                                        options={["any", ...MINIMUM_SCORES.map(String)]}
                                        optionLabel={option =>
                                            option === "any"
                                                ? t("discovery.anyScore")
                                                : t("discovery.minimumOption", {
                                                      score: format.number(Number(option)),
                                                  })
                                        }
                                        count={option =>
                                            option === "any"
                                                ? null
                                                : countCatalogue({
                                                      minScore:
                                                          MINIMUM_SCORES.find(
                                                              score => String(score) === option
                                                          ) ?? null,
                                                  })
                                        }
                                        onChange={value =>
                                            onCatalogue({
                                                minScore:
                                                    MINIMUM_SCORES.find(
                                                        score => String(score) === value
                                                    ) ?? null,
                                            })
                                        }
                                    />
                                )}
                            </Field>
                            <Field label={t("discovery.intake")}>
                                {id => (
                                    <FieldSelect
                                        id={id}
                                        value={catalogue.intake}
                                        options={INTAKE_FILTERS}
                                        optionLabel={option =>
                                            t(`discovery.intakeOptions.${option}`)
                                        }
                                        count={option =>
                                            option === "all"
                                                ? null
                                                : countCatalogue({ intake: option })
                                        }
                                        onChange={intake => onCatalogue({ intake })}
                                    />
                                )}
                            </Field>
                        </div>
                        <div className="border-line flex items-center gap-2 border-t pt-3">
                            <Switch
                                id="include-ineligible"
                                checked={vision.includeIneligible}
                                onCheckedChange={includeIneligible =>
                                    onVision({ includeIneligible })
                                }
                            />
                            <Label htmlFor="include-ineligible" className="text-ink-2 text-xs">
                                {t("vision.includeIneligible")}
                            </Label>
                        </div>
                    </PopoverContent>
                </Popover>
                <ChipSelect
                    ariaLabel={t("vision.sort")}
                    value={vision.sort}
                    active={false}
                    options={SORTS}
                    optionLabel={option => t(`vision.sortOptions.${option}`)}
                    onChange={sort => onVision({ sort })}
                />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <p
                    role="status"
                    aria-live="polite"
                    className="text-ink-3 mr-1 text-xs tabular-nums"
                >
                    {t("discovery.results", { count: resultCount, total: totalCount })}
                </p>
                {chips.map(chip => (
                    <Badge
                        key={chip.key}
                        asChild
                        variant="secondary"
                        className="cursor-pointer gap-1"
                    >
                        <button
                            type="button"
                            onClick={chip.clear}
                            aria-label={t("vision.removeFilter", { filter: chip.label })}
                        >
                            {chip.label}
                            <X />
                        </button>
                    </Badge>
                ))}
                {chips.length > 0 && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={onReset}
                    >
                        {t("discovery.reset")}
                    </Button>
                )}
            </div>
        </div>
    );
}
