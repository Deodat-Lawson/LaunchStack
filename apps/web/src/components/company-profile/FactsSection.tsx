"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import type { CiteEvidence } from "~/components/tools/Cite";
import { SectionHeading } from "~/components/tools/PageHeader";
import type { ProfileEntryDto, ProfileFactDto, ProfileFactPatch } from "~/lib/company-profile/dto";

import { ProfileRow } from "./ProfileRow";
import { factPathFor } from "./words";

/** Saves one patch; resolves once the profile has the answer, rejects when it failed (already reported). */
export type SaveFact = (patch: ProfileFactPatch) => Promise<void>;

/** The labelled facts, each with its excerpts, and — for an editor — the row that adds one by hand. */
export function FactsSection({
    facts,
    evidence,
    canEdit,
    onSave,
}: {
    facts: ProfileFactDto[];
    evidence: CiteEvidence[];
    canEdit: boolean;
    onSave: SaveFact;
}) {
    const t = useTranslations("companyProfile.facts");
    const cited = facts.some(f => f.cites.length > 0);
    if (facts.length === 0 && !canEdit) return null;
    return (
        <section aria-label={t("title")}>
            <SectionHeading
                title={t("title")}
                aside={
                    facts.length === 0
                        ? t("nothingProven")
                        : cited
                          ? t("countCited", { count: facts.length })
                          : t("count", { count: facts.length })
                }
            />
            <div className="border-line bg-panel overflow-hidden rounded-lg border">
                {facts.map(fact => (
                    <ProfileRow
                        key={fact.path}
                        label={fact.label}
                        value={fact.value}
                        cites={fact.cites}
                        evidence={evidence}
                        edited={fact.source === "manual"}
                        clearHint={t("clearFact")}
                        onSave={canEdit ? value => onSave({ path: fact.path, value }) : undefined}
                        onReset={
                            canEdit && fact.source === "manual"
                                ? () => onSave({ path: fact.path, value: "", reset: true })
                                : undefined
                        }
                    />
                ))}
                {canEdit && <AddFact taken={facts.map(f => f.path)} onSave={onSave} />}
            </div>
        </section>
    );
}

function AddFact({ taken, onSave }: { taken: string[]; onSave: SaveFact }) {
    const t = useTranslations("companyProfile.facts");
    const tc = useTranslations("common");
    const [open, setOpen] = useState(false);
    const [label, setLabel] = useState("");
    const [value, setValue] = useState("");
    const [busy, setBusy] = useState(false);
    const id = useId();

    const close = () => {
        setOpen(false);
        setLabel("");
        setValue("");
    };

    if (!open) {
        return (
            <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(true)}
                className="text-ink-2 border-line-2 h-auto w-full justify-start gap-2 rounded-none border-t px-4 py-2.5 text-left text-[13px] font-normal first:border-t-0"
            >
                <Plus className="size-3.5" />
                {t("addOpen")}
            </Button>
        );
    }

    return (
        <form
            className="border-line-2 grid gap-2 border-t px-4 py-3 first:border-t-0"
            aria-label={t("addLabel")}
            onSubmit={e => {
                e.preventDefault();
                const name = label.trim();
                const text = value.trim();
                if (!name || !text) return;
                setBusy(true);
                onSave({ path: factPathFor(name, taken), label: name, value: text })
                    .then(close)
                    .catch(() => undefined)
                    .finally(() => setBusy(false));
            }}
        >
            <div className="@max-md:grid-cols-1 grid grid-cols-[180px_minmax(0,1fr)] gap-1.5">
                <div className="grid content-start gap-1">
                    <Label htmlFor={`${id}-label`} className="text-xs">
                        {t("label")}
                    </Label>
                    <Input
                        id={`${id}-label`}
                        value={label}
                        onChange={e => setLabel(e.target.value)}
                        placeholder={t("labelPlaceholder")}
                        maxLength={120}
                        autoFocus
                    />
                </div>
                <div className="grid gap-1">
                    <Label htmlFor={`${id}-value`} className="text-xs">
                        {t("value")}
                    </Label>
                    <Textarea
                        id={`${id}-value`}
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === "Escape") {
                                e.preventDefault();
                                close();
                            }
                        }}
                        rows={2}
                        placeholder={t("valuePlaceholder")}
                        className="text-[13px]"
                    />
                </div>
            </div>
            <div className="flex gap-2">
                <Button size="sm" type="submit" disabled={busy || !label.trim() || !value.trim()}>
                    {t("add")}
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={close} disabled={busy}>
                    {tc("actions.cancel")}
                </Button>
            </div>
        </form>
    );
}

/** People, products and services, projects or agreements: name, detail, excerpts. Hidden when empty. */
export function EntriesSection({
    title,
    entries,
    evidence,
    canEdit,
    onSave,
}: {
    title: string;
    entries: ProfileEntryDto[];
    evidence: CiteEvidence[];
    canEdit: boolean;
    onSave: SaveFact;
}) {
    const t = useTranslations("companyProfile.facts");
    if (entries.length === 0) return null;
    return (
        <section aria-label={title}>
            <SectionHeading title={title} aside={String(entries.length)} />
            <div className="border-line bg-panel overflow-hidden rounded-lg border">
                {entries.map(entry => {
                    const detailPath = entry.detailPath;
                    return (
                        <ProfileRow
                            key={entry.path}
                            label={entry.name}
                            value={entry.detail}
                            cites={entry.cites}
                            evidence={evidence}
                            edited={entry.source === "manual"}
                            prominent
                            clearHint={t("clearEntry")}
                            onSave={
                                canEdit && detailPath
                                    ? value => onSave({ path: detailPath, value })
                                    : undefined
                            }
                            onReset={
                                canEdit && detailPath && entry.source === "manual"
                                    ? () => onSave({ path: detailPath, value: "", reset: true })
                                    : undefined
                            }
                            onRemove={
                                canEdit
                                    ? () => onSave({ path: `${entry.path}.name`, value: "" })
                                    : undefined
                            }
                        />
                    );
                })}
            </div>
        </section>
    );
}
