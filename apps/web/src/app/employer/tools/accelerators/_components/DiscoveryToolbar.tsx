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
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";

import { INVESTMENT_STAGES, REGIONS, SECTOR_TAGS, type SectorTag } from "../_lib/demo";
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
const VIEWS = ["any", "tracked", "pending"] as const;

function ChipSelect<T extends string>({
    value,
    options,
    optionLabel,
    onChange,
    ariaLabel,
    active,
}: {
    value: T;
    options: readonly T[];
    optionLabel: (option: T) => string;
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
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map(option => (
                    <SelectItem key={option} value={option}>
                        {optionLabel(option)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
    const id = useId();
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id} className="text-ink-2 text-xs">
                {label}
            </Label>
            {children(id)}
        </div>
    );
}

function FieldSelect<T extends string>({
    id,
    value,
    options,
    optionLabel,
    onChange,
}: {
    id: string;
    value: T;
    options: readonly T[];
    optionLabel: (option: T) => string;
    onChange: (value: T) => void;
}) {
    return (
        <Select value={value} onValueChange={next => onChange(next as T)}>
            <SelectTrigger id={id} size="sm">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map(option => (
                    <SelectItem key={option} value={option}>
                        {optionLabel(option)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

/**
 * One control surface for list views, result count, search, and filters.
 * Advanced facets sit behind More filters; active filters stay removable.
 */
export function DiscoveryToolbar({
    catalogue,
    vision,
    resultCount,
    totalCount,
    onCatalogue,
    onVision,
    onReset,
}: {
    catalogue: DiscoveryFilters;
    vision: VisionFilters;
    resultCount: number;
    totalCount: number;
    onCatalogue: (patch: Partial<DiscoveryFilters>) => void;
    onVision: (patch: Partial<VisionFilters>) => void;
    onReset: () => void;
}) {
    const t = useTranslations("accelerators");
    const format = useFormatter();
    const sectorLabel = (sector: SectorTag) => t(`details.sectors.${sector}`);
    const minScoreValue = catalogue.minScore === null ? "any" : String(catalogue.minScore);
    const advanced = [
        vision.deal !== "any",
        vision.region !== "any",
        vision.priority !== "any",
        catalogue.fit !== "all",
        catalogue.minScore !== null,
        catalogue.intake !== "all",
        vision.includeIneligible,
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
            label: t(`details.stages.${vision.stage}`),
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
            label: t(`details.regionNames.${vision.region}`),
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

    return (
        <div className="border-line bg-panel min-w-0 space-y-3 rounded-xl border p-3">
            <div className="border-line flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                <ToggleGroup
                    type="single"
                    size="sm"
                    value={VIEWS.find(value => value === vision.tracked) ?? "any"}
                    onValueChange={value =>
                        value && onVision({ tracked: value as VisionFilters["tracked"] })
                    }
                    aria-label={t("vision.tracked")}
                    className="flex-wrap justify-start"
                >
                    {VIEWS.map(value => (
                        <ToggleGroupItem key={value} value={value} className="px-3 text-xs">
                            {t(`vision.trackedOptions.${value}`)}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
                <p role="status" aria-live="polite" className="text-ink-3 text-xs tabular-nums">
                    {t("discovery.results", { count: resultCount, total: totalCount })}
                </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 basis-full sm:min-w-52 sm:basis-0">
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
                            className={`${CHIP} ${vision.sectors.length > 0 ? "border-brand/50 bg-brand-soft text-brand-ink" : ""}`}
                        >
                            {t("vision.sectors")}
                            {vision.sectors.length > 0 && (
                                <span className="tabular-nums">· {vision.sectors.length}</span>
                            )}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80 space-y-3">
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                            {SECTOR_TAGS.map(sector => {
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
                                            className="text-ink-2 text-xs font-normal"
                                        >
                                            {sectorLabel(sector)}
                                        </Label>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-ink-3 text-xs">{t("vision.sectorsHint")}</p>
                    </PopoverContent>
                </Popover>
                <ChipSelect
                    ariaLabel={t("vision.stage")}
                    value={vision.stage}
                    active={vision.stage !== "any"}
                    options={["any", ...INVESTMENT_STAGES] as const}
                    optionLabel={option =>
                        option === "any" ? t("vision.anyStage") : t(`details.stages.${option}`)
                    }
                    onChange={stage => onVision({ stage })}
                />
                <ChipSelect
                    ariaLabel={t("vision.deadline")}
                    value={vision.deadline}
                    active={vision.deadline !== "any"}
                    options={DEADLINE_WINDOWS}
                    optionLabel={option => t(`vision.deadlineOptions.${option}`)}
                    onChange={deadline => onVision({ deadline })}
                />
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className={`${CHIP} ${advanced > 0 ? "border-brand/50 bg-brand-soft text-brand-ink" : ""}`}
                        >
                            <SlidersHorizontal className="size-3.5" />
                            {t("vision.moreFilters")}
                            {advanced > 0 && <span className="tabular-nums">· {advanced}</span>}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 space-y-3">
                        <Field label={t("vision.deal")}>
                            {id => (
                                <FieldSelect
                                    id={id}
                                    value={vision.deal}
                                    options={DEAL_FILTERS}
                                    optionLabel={option => t(`vision.dealOptions.${option}`)}
                                    onChange={deal => onVision({ deal })}
                                />
                            )}
                        </Field>
                        <Field label={t("vision.region")}>
                            {id => (
                                <FieldSelect
                                    id={id}
                                    value={vision.region}
                                    options={["any", ...REGIONS] as const}
                                    optionLabel={option =>
                                        option === "any"
                                            ? t("vision.any")
                                            : t(`details.regionNames.${option}`)
                                    }
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
            {chips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
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
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={onReset}
                    >
                        {t("discovery.reset")}
                    </Button>
                </div>
            )}
        </div>
    );
}
