"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useResource } from "~/lib/tools/useResource";

import { prospectsApi, type NewSegmentInput } from "../api";

/** Either comma: people typing Chinese reach for the full-width one. */
const LIST_SPLIT = /[,，、]/;

type Intent = NonNullable<NewSegmentInput["intent"]>;

/** A segment's name from the first words of a description: "Tech companies worth $3B…". */
function shortName(text: string): string {
    const words = text.trim().split(/\s+/);
    return words.length > 6 ? `${words.slice(0, 6).join(" ")}…` : text.trim();
}

/**
 * Two kinds of list. "Find buyers" (the default): who you sell to, in three answers: what you sell, who buys it, and where.
 * The first and last are drafted from the company profile (its description
 * and headquarters); "who buys" is always the member's, because the seller's
 * own industry says nothing about its customers'. Places are typed the way
 * people write them ("Baltimore, MD, USA; Netherlands"), not as ISO codes.
 * "Find companies like this": a description of the companies themselves
 * ("tech companies worth $3B or more") and where — each found company is
 * checked against the description, not against what you sell.
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
    const [intent, setIntent] = useState<Intent>("partners");
    const [description, setDescription] = useState("");
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
    const companies = intent === "companies";
    const valid = companies
        ? description.trim().length > 0 && places.length > 0
        : offering.trim().length > 0 && industries.length > 0 && places.length > 0;

    const submit = () => {
        if (!valid || busy) return;
        if (companies) {
            onSubmit({
                intent: "companies",
                name: t("defaultName", { buyers: shortName(description), where: places[0]! }),
                offering: description.trim(),
                industries: [],
                places,
            });
            return;
        }
        onSubmit({
            name: t("defaultName", {
                buyers: industries.slice(0, 2).join(", "),
                where: places[0]!,
            }),
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
            <ToggleGroup
                type="single"
                value={intent}
                onValueChange={v => v && setIntent(v as Intent)}
                size="sm"
                className="border-line bg-panel w-full rounded-md border p-0.5"
                aria-label={t("intent.aria")}
            >
                <ToggleGroupItem
                    value="partners"
                    className="data-[state=on]:shadow-1 h-8 flex-1 rounded-[5px] px-3 text-[13px]"
                >
                    {t("intent.partners")}
                </ToggleGroupItem>
                <ToggleGroupItem
                    value="companies"
                    className="data-[state=on]:shadow-1 h-8 flex-1 rounded-[5px] px-3 text-[13px]"
                >
                    {t("intent.companies")}
                </ToggleGroupItem>
            </ToggleGroup>
            {companies && (
                <div className="grid gap-1.5">
                    <Label htmlFor={`${idPrefix}-describe`} className="text-[13px] font-medium">
                        {t("describe")}
                    </Label>
                    <Textarea
                        id={`${idPrefix}-describe`}
                        rows={2}
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder={t("describePlaceholder")}
                        autoFocus={autoFocus}
                        aria-describedby={`${idPrefix}-describe-hint`}
                    />
                    <p id={`${idPrefix}-describe-hint`} className="text-ink-3 text-xs">
                        {t("describeHint")}
                    </p>
                </div>
            )}
            <div className={companies ? "hidden" : "grid gap-1.5"}>
                <Label htmlFor={`${idPrefix}-buyers`} className="text-[13px] font-medium">
                    {t("buyers")}
                </Label>
                <Input
                    id={`${idPrefix}-buyers`}
                    value={buyers}
                    onChange={e => setBuyers(e.target.value)}
                    placeholder={t("buyersPlaceholder")}
                    autoFocus={autoFocus}
                    aria-describedby={`${idPrefix}-buyers-hint`}
                />
                <p id={`${idPrefix}-buyers-hint`} className="text-ink-3 text-xs">
                    {t("buyersHint")}
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
                    aria-describedby={`${idPrefix}-where-hint`}
                />
                <p id={`${idPrefix}-where-hint`} className="text-ink-3 text-xs">
                    {companies
                        ? t("whereHintCompanies")
                        : draft?.basis.headquarters && !touched.where
                          ? t("whereFromProfile")
                          : t("whereHint")}
                </p>
            </div>
            <div className={companies ? "hidden" : "grid gap-1.5"}>
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
                    aria-describedby={`${idPrefix}-offering-hint`}
                />
                <p id={`${idPrefix}-offering-hint`} className="text-ink-3 text-xs">
                    {draft?.basis.profile && !touched.offering
                        ? t("offeringFromProfile")
                        : t("offeringHint")}
                </p>
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
