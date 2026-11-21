"use client";

import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Field } from "~/components/field";
import { useToolNav } from "~/components/tool-app/nav";
import { PageHeader } from "~/components/tools/PageHeader";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";

import { paths } from "./bits";
import { CONTRACTS, OWNERS } from "./data";

/**
 * A form that makes something: its own screen when it has more than three
 * or four inputs (fewer, and it is a dialog).
 *
 * - One column, at most 640px wide, on the screen's left edge — no card
 *   around it; the screen is the surface.
 * - Labels above controls (`Field`), a hint only where the label is not
 *   enough, errors under the control that has them, in words that say how
 *   to fix it.
 * - The buttons sit at the end of the form, next to what they submit: the
 *   primary action names what it makes ("Create renewal"), Cancel goes back.
 * - Validation runs on submit, then focuses the first field to fix.
 */
export function NewScreen() {
    const t = useTranslations("designTemplate.create");
    const tc = useTranslations("common.actions");
    const { navigate, back, canBack } = useToolNav();
    const ids = {
        vendor: useId(),
        source: useId(),
        renews: useId(),
        value: useId(),
        owner: useId(),
        notes: useId(),
        remind: useId(),
    };
    const vendorRef = useRef<HTMLInputElement>(null);
    const renewsRef = useRef<HTMLInputElement>(null);
    const [errors, setErrors] = useState<{ vendor?: string; renews?: string }>({});
    const [remind, setRemind] = useState(true);

    function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const text = (name: string) => {
            const value = data.get(name);
            return typeof value === "string" ? value.trim() : "";
        };
        const next: typeof errors = {};
        if (!text("vendor")) next.vendor = t("vendorError");
        if (!text("renewsOn")) next.renews = t("renewsOnError");
        setErrors(next);
        if (next.vendor) return vendorRef.current?.focus();
        if (next.renews) return renewsRef.current?.focus();
        toast.success(t("created"));
        navigate(paths.contract(CONTRACTS[0]!.id));
    }

    return (
        <div className="mx-auto flex max-w-[1080px] flex-col gap-7">
            <PageHeader size="md" title={t("title")} sub={t("sub")} />
            <form noValidate onSubmit={submit} className="flex max-w-[640px] flex-col">
                <Field label={t("vendor")} htmlFor={ids.vendor} error={errors.vendor}>
                    <Input
                        ref={vendorRef}
                        id={ids.vendor}
                        name="vendor"
                        autoComplete="off"
                        aria-invalid={Boolean(errors.vendor)}
                    />
                </Field>
                <Field label={t("source")} htmlFor={ids.source} hint={t("sourceHint")}>
                    <Select name="source">
                        <SelectTrigger id={ids.source} className="w-full">
                            <SelectValue placeholder={t("sourcePlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                            {CONTRACTS.map(c => (
                                <SelectItem key={c.source.id} value={c.source.id}>
                                    {c.source.title}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
                <div className="@max-sm:grid-cols-1 grid grid-cols-2 gap-x-4">
                    <Field label={t("renewsOn")} htmlFor={ids.renews} error={errors.renews}>
                        <Input
                            ref={renewsRef}
                            id={ids.renews}
                            name="renewsOn"
                            type="date"
                            aria-invalid={Boolean(errors.renews)}
                        />
                    </Field>
                    <Field label={t("value")} htmlFor={ids.value} hint={t("valueHint")}>
                        <Input
                            id={ids.value}
                            name="value"
                            inputMode="decimal"
                            className="tabular-nums"
                        />
                    </Field>
                </div>
                <Field label={t("owner")} htmlFor={ids.owner}>
                    <Select name="owner" defaultValue={OWNERS[0]}>
                        <SelectTrigger id={ids.owner} className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {OWNERS.map(owner => (
                                <SelectItem key={owner} value={owner}>
                                    {owner}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
                <Field label={t("notes")} htmlFor={ids.notes}>
                    <Textarea
                        id={ids.notes}
                        name="notes"
                        rows={3}
                        placeholder={t("notesPlaceholder")}
                    />
                </Field>
                {/* Part of what this form submits, so a Checkbox: a Switch applies at once. */}
                <div className="mb-6 flex items-center gap-2.5">
                    <Checkbox
                        id={ids.remind}
                        name="remind"
                        checked={remind}
                        onCheckedChange={value => setRemind(value === true)}
                    />
                    <Label htmlFor={ids.remind} className="text-ink text-sm font-normal">
                        {t("remind")}
                    </Label>
                </div>
                <div className="border-line flex flex-wrap items-center gap-2 border-t pt-4">
                    <Button type="submit">{t("submit")}</Button>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => (canBack ? back() : navigate(paths.overview()))}
                    >
                        {tc("cancel")}
                    </Button>
                </div>
            </form>
        </div>
    );
}
