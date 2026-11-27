"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import {
    SEGMENT_LIMITS,
    fitSegmentName,
    segmentLimitProblems,
    type SegmentLimitProblem,
} from "~/lib/prospects/segment-limits";
import { useResource } from "~/lib/tools/useResource";
import { cn } from "~/lib/utils";

import { prospectsApi, type NewSegmentInput } from "../api";

/** Either comma: people typing Chinese reach for the full-width one. */
const LIST_SPLIT = /[,，、]/;

/** "What you sell" shows how much it holds from this share of its limit on. */
const COUNT_FROM = 0.8;

/**
 * Who you sell to, in three answers: what you sell, who buys it, and where.
 * The first and last are drafted from the company profile (its description
 * and headquarters); "who buys" is always the member's, because the seller's
 * own industry says nothing about its customers'. Places are typed the way
 * people write them ("Baltimore, MD, USA; Netherlands"), not as ISO codes.
 */
export function SegmentForm({
    idPrefix,
    submitLabel,
    busy,
    onSubmit,
    autoFocus = false,
}: {
    idPrefix: string;
    submitLabel: string;
    busy: boolean;
    onSubmit: (input: NewSegmentInput) => void;
    autoFocus?: boolean;
}) {
    const t = useTranslations("growth.prospects.setup");
    const suggestion = useResource("segment-suggestion", () => prospectsApi.segmentSuggestion());
    const [offering, setOffering] = useState("");
    const [buyers, setBuyers] = useState("");
    const [where, setWhere] = useState("");
    const [touched, setTouched] = useState({ offering: false, where: false });

    // Fill in the draft once it arrives, without overwriting what the member typed.
    const draft = suggestion.data?.suggestion;
    useEffect(() => {
        if (!draft) return;
        if (!touched.offering && draft.offering) setOffering(draft.offering);
        if (!touched.where && draft.place) setWhere(draft.place);
        // Only when the draft arrives.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft]);

    const industries = buyers
        .split(LIST_SPLIT)
        .map(s => s.trim())
        .filter(Boolean);
    const places = where
        .split(/[;\n]+/)
        .map(s => s.trim())
        .filter(Boolean);
    // Over a limit says so beside the answer, before anything is sent.
    const problems = segmentLimitProblems({ offering: offering.trim(), industries, places });
    const problemFor = (field: SegmentLimitProblem["field"]) =>
        problems.find(p => p.field === field);
    const problemText = (problem: SegmentLimitProblem) =>
        t(problem.key, { count: problem.count, max: problem.max });
    const buyersProblem = problemFor("buyers");
    const placesProblem = problemFor("places");
    const offeringProblem = problemFor("offering");
    const offeringLength = offering.trim().length;
    const showCount = offeringLength >= SEGMENT_LIMITS.offering * COUNT_FROM;

    const valid =
        offering.trim().length > 0 &&
        industries.length > 0 &&
        places.length > 0 &&
        problems.length === 0;

    const submit = () => {
        if (!valid || busy) return;
        onSubmit({
            // Made from the answers, so cut to fit rather than refused.
            name: fitSegmentName(
                t("defaultName", {
                    buyers: industries.slice(0, 2).join(", "),
                    where: places[0]!,
                })
            ),
            offering: offering.trim(),
            industries,
            places,
        });
    };

    return (
        <form
            className="grid gap-4"
            onSubmit={e => {
                e.preventDefault();
                submit();
            }}
        >
            <div className="grid gap-1.5">
                <Label htmlFor={`${idPrefix}-buyers`} className="text-[13px] font-medium">
                    {t("buyers")}
                </Label>
                <Input
                    id={`${idPrefix}-buyers`}
                    value={buyers}
                    onChange={e => setBuyers(e.target.value)}
                    placeholder={t("buyersPlaceholder")}
                    autoFocus={autoFocus}
                    aria-invalid={buyersProblem ? true : undefined}
                    aria-describedby={`${idPrefix}-buyers-hint`}
                />
                <p
                    id={`${idPrefix}-buyers-hint`}
                    className={cn("text-xs", buyersProblem ? "text-danger" : "text-ink-3")}
                    role={buyersProblem ? "alert" : undefined}
                >
                    {buyersProblem ? problemText(buyersProblem) : t("buyersHint")}
                </p>
            </div>
            <div className="grid gap-1.5">
                <Label htmlFor={`${idPrefix}-where`} className="text-[13px] font-medium">
                    {t("where")}
                </Label>
                <Input
                    id={`${idPrefix}-where`}
                    value={where}
                    onChange={e => {
                        setWhere(e.target.value);
                        setTouched(v => ({ ...v, where: true }));
                    }}
                    placeholder={t("wherePlaceholder")}
                    aria-invalid={placesProblem ? true : undefined}
                    aria-describedby={`${idPrefix}-where-hint`}
                />
                <p
                    id={`${idPrefix}-where-hint`}
                    className={cn("text-xs", placesProblem ? "text-danger" : "text-ink-3")}
                    role={placesProblem ? "alert" : undefined}
                >
                    {placesProblem
                        ? problemText(placesProblem)
                        : draft?.basis.headquarters && !touched.where
                          ? t("whereFromProfile")
                          : t("whereHint")}
                </p>
            </div>
            <div className="grid gap-1.5">
                <Label htmlFor={`${idPrefix}-offering`} className="text-[13px] font-medium">
                    {t("offering")}
                </Label>
                <Textarea
                    id={`${idPrefix}-offering`}
                    rows={2}
                    value={offering}
                    onChange={e => {
                        setOffering(e.target.value);
                        setTouched(v => ({ ...v, offering: true }));
                    }}
                    placeholder={t("offeringPlaceholder")}
                    aria-invalid={offeringProblem ? true : undefined}
                    aria-describedby={`${idPrefix}-offering-hint`}
                />
                <div className="flex items-start justify-between gap-3">
                    <p
                        id={`${idPrefix}-offering-hint`}
                        className={cn("text-xs", offeringProblem ? "text-danger" : "text-ink-3")}
                        role={offeringProblem ? "alert" : undefined}
                    >
                        {offeringProblem
                            ? problemText(offeringProblem)
                            : draft?.basis.profile && !touched.offering
                              ? t("offeringFromProfile")
                              : t("offeringHint")}
                    </p>
                    {showCount && (
                        <span
                            data-testid={`${idPrefix}-offering-count`}
                            className={cn(
                                "shrink-0 text-xs tabular-nums",
                                offeringProblem ? "text-danger" : "text-ink-3"
                            )}
                        >
                            {t("offeringCount", {
                                count: offeringLength,
                                max: SEGMENT_LIMITS.offering,
                            })}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex items-center justify-end gap-2">
                <Button type="submit" size="sm" disabled={!valid || busy}>
                    {busy && <Spinner className="size-3.5" />}
                    {submitLabel}
                </Button>
            </div>
        </form>
    );
}
