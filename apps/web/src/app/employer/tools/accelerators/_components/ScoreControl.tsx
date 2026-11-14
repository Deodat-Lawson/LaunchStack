"use client";

import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

import { MAX_PROGRAMS_PER_RUN } from "@launchstack/pipelines/accelerators/fit";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useErrorText } from "~/lib/tools/errorText";

import type { ProgramView } from "../api";
import { useAccelerators } from "../_lib/context";

/** How many of the current order "Top N" scores until the user changes it. */
export const DEFAULT_TOP_PROGRAMS = 30;

type Scope = "top" | "filtered";

/** The chosen Programs: the first `top` of the current order, or all of it. */
export function chosenPrograms(visible: readonly ProgramView[], scope: Scope, top: number) {
    const limit = scope === "filtered" ? visible.length : Math.max(0, Math.floor(top) || 0);
    return visible.slice(0, Math.min(limit, MAX_PROGRAMS_PER_RUN));
}

/**
 * Starts scoring for a user-chosen set: the top N of the list as currently filtered
 * and sorted, or everything filtered. Chosen Programs whose saved result is still
 * current are skipped unless the user asks to re-score them (the server applies the
 * same rule), so the button's count and credits are exactly what the run sends and
 * debits (per Program scored).
 */
export function ScoreControl({ visible }: { visible: readonly ProgramView[] }) {
    const t = useTranslations("accelerators.scoring");
    const tc = useTranslations("accelerators");
    const format = useFormatter();
    const errorText = useErrorText();
    const { home, runBusy, match } = useAccelerators();
    const [scope, setScope] = useState<Scope>("top");
    const [top, setTop] = useState(DEFAULT_TOP_PROGRAMS);
    const [rescore, setRescore] = useState(false);
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const pendingRef = useRef(false);
    const [failure, setFailure] = useState<unknown>(null);
    const fieldId = useId();
    if (!home) return null;

    const chosen = chosenPrograms(visible, scope, top);
    const ids = chosen
        .filter(view => rescore || view.freshness.status !== "current")
        .map(view => view.program.id);
    const skipped = chosen.length - ids.length;
    const rate = home.costs.matchPerProgram;
    const credits = format.number(ids.length * rate);
    const allCurrent = chosen.length > 0 && ids.length === 0;
    const label = allCurrent
        ? t("allCurrentShort", { count: chosen.length })
        : t("button", { count: ids.length, credits });
    // Reasons that leave nothing to choose. "All current" is not one: the options
    // stay open so re-scoring can be turned on.
    const reason = !home.canEdit
        ? tc("common.readOnly")
        : !home.profileReady
          ? tc("home.profileMissing")
          : runBusy
            ? t("running")
            : chosen.length === 0
              ? t("nothingSelected")
              : null;
    const capped =
        (scope === "filtered" ? visible.length : Math.min(top, visible.length)) >
        MAX_PROGRAMS_PER_RUN;

    const start = async () => {
        if (pendingRef.current || reason || ids.length === 0) return;
        pendingRef.current = true;
        setPending(true);
        setFailure(null);
        try {
            await match(ids, rescore);
            setOpen(false);
        } catch (error) {
            setFailure(error);
        } finally {
            pendingRef.current = false;
            setPending(false);
        }
    };

    const trigger = (
        <Button type="button" disabled={reason !== null || pending}>
            {pending ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" />
            ) : (
                <Sparkles />
            )}
            {pending ? t("scoring") : label}
            <ChevronDown className="opacity-70" />
        </Button>
    );

    if (reason !== null) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span tabIndex={0}>{trigger}</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">{reason}</TooltipContent>
            </Tooltip>
        );
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-4">
                <div className="space-y-1">
                    <h2 className="text-ink text-sm font-semibold">{t("title")}</h2>
                    <p className="text-ink-3 text-xs leading-relaxed">{t("hint")}</p>
                </div>
                <RadioGroup
                    value={scope}
                    onValueChange={value => setScope(value as Scope)}
                    className="gap-3"
                >
                    <div className="flex items-start gap-2">
                        <RadioGroupItem value="top" id={`${fieldId}-top`} className="mt-0.5" />
                        <div className="min-w-0 flex-1 space-y-2">
                            <Label htmlFor={`${fieldId}-top`} className="text-sm font-normal">
                                {t("scopeTop")}
                            </Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    max={MAX_PROGRAMS_PER_RUN}
                                    value={top}
                                    aria-label={t("scopeTopCount")}
                                    className="h-8 w-20"
                                    onFocus={() => setScope("top")}
                                    onChange={event => {
                                        setScope("top");
                                        setTop(Math.max(0, Number(event.target.value) || 0));
                                    }}
                                />
                                <span className="text-ink-3 text-xs">
                                    {t("ofVisible", { count: visible.length })}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-start gap-2">
                        <RadioGroupItem
                            value="filtered"
                            id={`${fieldId}-filtered`}
                            className="mt-0.5"
                        />
                        <Label htmlFor={`${fieldId}-filtered`} className="text-sm font-normal">
                            {t("scopeFiltered", { count: visible.length })}
                        </Label>
                    </div>
                </RadioGroup>
                <div className="flex items-start gap-2">
                    <Checkbox
                        id={`${fieldId}-rescore`}
                        checked={rescore}
                        onCheckedChange={checked => setRescore(checked === true)}
                        className="mt-0.5"
                    />
                    <div className="space-y-0.5">
                        <Label htmlFor={`${fieldId}-rescore`} className="text-sm font-normal">
                            {t("rescore")}
                        </Label>
                        <p className="text-ink-3 text-xs leading-relaxed">{t("rescoreHint")}</p>
                    </div>
                </div>
                <div className="border-line space-y-1 border-t pt-3 text-xs">
                    {allCurrent ? (
                        <p role="status" className="text-ink-2 leading-relaxed">
                            {t("allCurrent", { count: chosen.length })}
                        </p>
                    ) : (
                        <p className="text-ink font-medium tabular-nums">
                            {t("estimate", {
                                count: ids.length,
                                rate: format.number(rate),
                                credits,
                            })}
                        </p>
                    )}
                    {skipped > 0 && !allCurrent && (
                        <p className="text-ink-3">{t("skippedCurrent", { count: skipped })}</p>
                    )}
                    {capped && (
                        <p className="text-warn">{t("capped", { max: MAX_PROGRAMS_PER_RUN })}</p>
                    )}
                    <p className="text-ink-3 leading-relaxed">{t("estimateHint")}</p>
                </div>
                {failure != null && (
                    <p role="alert" className="text-danger text-xs">
                        {errorText(failure, tc("common.actionFailed"))}
                    </p>
                )}
                <Button
                    type="button"
                    className="w-full"
                    disabled={pending || ids.length === 0}
                    onClick={start}
                >
                    {pending && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                    {pending ? t("scoring") : t("start", { count: ids.length })}
                </Button>
            </PopoverContent>
        </Popover>
    );
}
