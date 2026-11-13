"use client";

/**
 * Models & usage › Models › In Ask's model menu: the models a workspace
 * offers beside Standard and Fast.
 *
 * Each row is a model the workspace's own key serves, the name everyone sees
 * it under, what it can do (the admin says; nothing is inferred from the id)
 * and, optionally, what the provider charges for it. Picking an id from the
 * key's listing fills an empty name with the provider's model name and empty
 * prices with the catalogue's (OpenRouter lists them).
 *
 * Saved on its own (`PUT …/workspace/offered`), apart from API keys: the
 * whole list each time, in menu order. A row already saved keeps its key, so
 * a rename never breaks a draft or a favourite that names it.
 */

import React, { useEffect, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { MAX_OFFERED_LABEL_CHARS, MAX_OFFERED_MODELS } from "~/lib/ai/model-picks";
import { MAX_PRICE_PER_MTOK, isPlausiblePrice } from "~/lib/ai/model-pricing";

import { StatusNote } from "../settings/ui";
import {
    WORKSPACE_ENDPOINT_URL,
    type WorkspaceEndpointView,
    type WorkspaceModelPricing,
} from "../settings/WorkspaceModelPanel";

const OFFERED_URL = `${WORKSPACE_ENDPOINT_URL}/offered`;
const MODELS_URL = `${WORKSPACE_ENDPOINT_URL}/models`;

/** An offered model as saved (mirrors `WorkspaceOfferedModel`). */
interface OfferedView {
    key: string;
    label: string;
    id: string;
    vision: boolean;
    reasoning: boolean;
    structuredOutput?: boolean;
    pricing?: WorkspaceModelPricing;
}

interface Draft {
    /** Stable for React; a saved row's key, or a fresh local id. */
    uid: string;
    key?: string;
    label: string;
    /** True while the name is still the one filled in from the id. */
    autoLabel: boolean;
    id: string;
    vision: boolean;
    reasoning: boolean;
    structuredOutput: boolean;
    priceIn: string;
    priceOut: string;
}

const priceText = (value: number | undefined) => (value === undefined ? "" : String(value));

function draftOf(model: OfferedView): Draft {
    return {
        uid: model.key,
        key: model.key,
        label: model.label,
        autoLabel: false,
        id: model.id,
        vision: model.vision,
        reasoning: model.reasoning,
        structuredOutput: model.structuredOutput ?? false,
        priceIn: priceText(model.pricing?.input),
        priceOut: priceText(model.pricing?.output),
    };
}

function draftsOf(endpoint: WorkspaceEndpointView): Draft[] {
    const offered = (endpoint.models as { offered?: OfferedView[] } | null)?.offered ?? [];
    return offered.map(draftOf);
}

/** The provider's name for a model: its id after the vendor prefix (`openai/gpt-5-mini`). */
export function suggestedLabel(id: string): string {
    const trimmed = id.trim();
    const tail = trimmed.slice(trimmed.lastIndexOf("/") + 1);
    return (tail || trimmed).slice(0, MAX_OFFERED_LABEL_CHARS);
}

const parsePrice = (text: string): number | null | "bad" => {
    if (!text.trim()) return null;
    const value = Number(text.trim());
    return isPlausiblePrice(value) ? value : "bad";
};

type Problem = "name" | "nameLong" | "sameName" | "id" | "price";

function problemsOf(drafts: readonly Draft[]): Map<string, Problem> {
    const problems = new Map<string, Problem>();
    const seen = new Set<string>();
    for (const draft of drafts) {
        const label = draft.label.trim();
        const folded = label.toLocaleLowerCase();
        const priceIn = parsePrice(draft.priceIn);
        const priceOut = parsePrice(draft.priceOut);
        if (!draft.id.trim() || /\s/.test(draft.id.trim())) problems.set(draft.uid, "id");
        else if (!label) problems.set(draft.uid, "name");
        else if (label.length > MAX_OFFERED_LABEL_CHARS) problems.set(draft.uid, "nameLong");
        else if (seen.has(folded)) problems.set(draft.uid, "sameName");
        else if (
            priceIn === "bad" ||
            priceOut === "bad" ||
            (priceIn === null) !== (priceOut === null)
        )
            problems.set(draft.uid, "price");
        if (label) seen.add(folded);
    }
    return problems;
}

/** What the save route takes for the list. */
function payloadOf(drafts: readonly Draft[]) {
    return drafts.map(draft => {
        const input = parsePrice(draft.priceIn);
        const output = parsePrice(draft.priceOut);
        return {
            ...(draft.key ? { key: draft.key } : {}),
            label: draft.label.trim(),
            id: draft.id.trim(),
            vision: draft.vision,
            reasoning: draft.reasoning,
            structuredOutput: draft.structuredOutput,
            pricing:
                typeof input === "number" && typeof output === "number" ? { input, output } : null,
        };
    });
}

let localIds = 0;

export function OfferedModelsEditor({
    endpoint,
    onSaved,
}: {
    endpoint: WorkspaceEndpointView;
    onSaved: (endpoint: WorkspaceEndpointView) => void;
}) {
    const t = useTranslations("usage.models.editor");
    const ids = useId();
    const listId = `${ids}-models`;
    const [drafts, setDrafts] = useState<Draft[]>(() => draftsOf(endpoint));
    const [saved, setSaved] = useState(() => JSON.stringify(payloadOf(draftsOf(endpoint))));
    const [status, setStatus] = useState<
        | { kind: "idle" }
        | { kind: "saving" }
        | { kind: "saved" }
        | { kind: "failed"; message: string }
    >({ kind: "idle" });
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [prices, setPrices] = useState<Map<string, WorkspaceModelPricing>>(new Map());
    const [listing, setListing] = useState<"loading" | "done" | "failed">("loading");

    // What the workspace's key can reach, to pick from. A failure only means
    // typing the id by hand.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(MODELS_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        provider: endpoint.provider,
                        baseUrl: endpoint.baseUrl,
                    }),
                });
                if (!res.ok) throw new Error(String(res.status));
                const body = (await res.json()) as {
                    models?: string[];
                    prices?: Record<string, WorkspaceModelPricing>;
                };
                if (cancelled) return;
                setSuggestions([...new Set(body.models ?? [])].sort((a, b) => a.localeCompare(b)));
                setPrices(new Map(Object.entries(body.prices ?? {})));
                setListing("done");
            } catch {
                if (!cancelled) setListing("failed");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [endpoint.provider, endpoint.baseUrl]);

    const problems = useMemo(() => problemsOf(drafts), [drafts]);
    const payload = useMemo(() => payloadOf(drafts), [drafts]);
    const dirty = JSON.stringify(payload) !== saved;
    const full = drafts.length >= MAX_OFFERED_MODELS;

    const edit = (uid: string, patch: Partial<Draft>) => {
        setStatus(current => (current.kind === "saving" ? current : { kind: "idle" }));
        setDrafts(current =>
            current.map(draft => {
                if (draft.uid !== uid) return draft;
                const next = { ...draft, ...patch };
                if (patch.id !== undefined) {
                    // A name still filled in from the id follows it.
                    if (draft.autoLabel || !draft.label.trim()) {
                        next.label = suggestedLabel(patch.id);
                        next.autoLabel = true;
                    }
                    const price = prices.get(patch.id.trim());
                    if (price && !draft.priceIn.trim() && !draft.priceOut.trim()) {
                        next.priceIn = priceText(price.input);
                        next.priceOut = priceText(price.output);
                    }
                }
                if (patch.label !== undefined) next.autoLabel = false;
                return next;
            })
        );
    };

    const add = () => {
        setStatus({ kind: "idle" });
        setDrafts(current => [
            ...current,
            {
                uid: `new-${++localIds}`,
                label: "",
                autoLabel: true,
                id: "",
                vision: false,
                reasoning: false,
                structuredOutput: false,
                priceIn: "",
                priceOut: "",
            },
        ]);
    };

    const remove = (uid: string) => {
        setStatus({ kind: "idle" });
        setDrafts(current => current.filter(draft => draft.uid !== uid));
    };

    const save = async () => {
        setStatus({ kind: "saving" });
        try {
            const res = await fetch(OFFERED_URL, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ offered: payload }),
            });
            const body = (await res.json().catch(() => ({}))) as {
                endpoint?: WorkspaceEndpointView | null;
                error?: string;
            };
            if (!res.ok || !body.endpoint) {
                setStatus({ kind: "failed", message: body.error ?? t("saveFailed") });
                return;
            }
            const next = draftsOf(body.endpoint);
            setDrafts(next);
            setSaved(JSON.stringify(payloadOf(next)));
            setStatus({ kind: "saved" });
            onSaved(body.endpoint);
        } catch {
            setStatus({ kind: "failed", message: t("saveFailed") });
        }
    };

    const discard = () => {
        const restored = draftsOf(endpoint);
        setDrafts(restored);
        setStatus({ kind: "idle" });
    };

    return (
        <div className="flex flex-col gap-3" data-testid="offered-models-editor">
            <datalist id={listId}>
                {suggestions.map(id => (
                    <option key={id} value={id} />
                ))}
            </datalist>

            {drafts.length === 0 ? (
                <p className="text-ink-3 m-0 text-[12.5px]">{t("none")}</p>
            ) : (
                <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
                    {drafts.map((draft, index) => (
                        <OfferedRow
                            key={draft.uid}
                            draft={draft}
                            index={index}
                            listId={listId}
                            problem={problems.get(draft.uid)}
                            onChange={patch => edit(draft.uid, patch)}
                            onRemove={() => remove(draft.uid)}
                        />
                    ))}
                </ol>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={add}
                    disabled={full}
                    title={full ? t("full", { max: MAX_OFFERED_MODELS }) : undefined}
                    data-testid="offered-models-add"
                >
                    <Plus className="size-3.5" />
                    {t("add")}
                </Button>
                <span className="text-ink-3 text-[12px]">
                    {listing === "loading"
                        ? t("listing")
                        : listing === "failed"
                          ? t("listFailed")
                          : t("listed", { count: suggestions.length })}
                </span>
                <span className="flex-1" />
                {dirty && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={discard}
                        disabled={status.kind === "saving"}
                    >
                        {t("discard")}
                    </Button>
                )}
                <Button
                    type="button"
                    size="sm"
                    onClick={() => void save()}
                    disabled={!dirty || problems.size > 0 || status.kind === "saving"}
                    data-testid="offered-models-save"
                >
                    {status.kind === "saving" ? t("saving") : t("save")}
                </Button>
            </div>

            {status.kind === "saved" && (
                <StatusNote tone="ok" style={{ marginBottom: 0 }}>
                    {t("saved")}
                </StatusNote>
            )}
            {status.kind === "failed" && (
                <StatusNote tone="danger" style={{ marginBottom: 0 }}>
                    {status.message}
                </StatusNote>
            )}
        </div>
    );
}

function OfferedRow({
    draft,
    index,
    listId,
    problem,
    onChange,
    onRemove,
}: {
    draft: Draft;
    index: number;
    listId: string;
    problem: Problem | undefined;
    onChange: (patch: Partial<Draft>) => void;
    onRemove: () => void;
}) {
    const t = useTranslations("usage.models.editor");
    const id = useId();
    const name = draft.label.trim() || t("untitled", { n: index + 1 });
    return (
        <li
            className="border-line bg-panel flex flex-col gap-3 rounded-lg border p-3"
            data-testid="offered-model-row"
        >
            <div className="@max-md:grid-cols-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-end gap-3">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor={`${id}-label`} className="text-ink-2 text-[12px]">
                        {t("name")}
                    </Label>
                    <Input
                        id={`${id}-label`}
                        value={draft.label}
                        onChange={event => onChange({ label: event.target.value })}
                        placeholder={t("namePlaceholder")}
                        maxLength={MAX_OFFERED_LABEL_CHARS}
                        autoComplete="off"
                        aria-invalid={
                            problem === "name" || problem === "nameLong" || problem === "sameName"
                                ? true
                                : undefined
                        }
                    />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor={`${id}-model`} className="text-ink-2 text-[12px]">
                        {t("model")}
                    </Label>
                    <Input
                        id={`${id}-model`}
                        list={listId}
                        value={draft.id}
                        onChange={event => onChange({ id: event.target.value })}
                        placeholder={t("modelPlaceholder")}
                        autoComplete="off"
                        spellCheck={false}
                        className="mono placeholder:font-sans"
                        aria-invalid={problem === "id" ? true : undefined}
                    />
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-ink-3 hover:text-danger @max-md:justify-self-end size-9"
                    aria-label={t("remove", { name })}
                    onClick={onRemove}
                >
                    <Trash2 className="size-4" />
                </Button>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
                {(
                    [
                        ["vision", t("vision")],
                        ["reasoning", t("reasoning")],
                        ["structuredOutput", t("structured")],
                    ] as const
                ).map(([field, label]) => (
                    <div key={field} className="flex items-center gap-2">
                        <Checkbox
                            id={`${id}-${field}`}
                            checked={draft[field]}
                            onCheckedChange={checked => onChange({ [field]: checked === true })}
                        />
                        <Label
                            htmlFor={`${id}-${field}`}
                            className="text-ink-2 text-[12.5px] font-normal"
                        >
                            {label}
                        </Label>
                    </div>
                ))}
                <span className="flex-1" />
                <div className="flex items-center gap-2">
                    <Label htmlFor={`${id}-in`} className="text-ink-3 text-[12px] font-normal">
                        {t("priceIn")}
                    </Label>
                    <Input
                        id={`${id}-in`}
                        value={draft.priceIn}
                        onChange={event => onChange({ priceIn: event.target.value })}
                        inputMode="decimal"
                        autoComplete="off"
                        className="h-8 w-20 text-[12.5px]"
                        aria-invalid={problem === "price" ? true : undefined}
                    />
                    <Label htmlFor={`${id}-out`} className="text-ink-3 text-[12px] font-normal">
                        {t("priceOut")}
                    </Label>
                    <Input
                        id={`${id}-out`}
                        value={draft.priceOut}
                        onChange={event => onChange({ priceOut: event.target.value })}
                        inputMode="decimal"
                        autoComplete="off"
                        className="h-8 w-20 text-[12.5px]"
                        aria-invalid={problem === "price" ? true : undefined}
                    />
                </div>
            </div>

            {problem && (
                <p className="text-danger-ink m-0 text-[12px]" role="alert">
                    {t(`problems.${problem}`, {
                        max: problem === "nameLong" ? MAX_OFFERED_LABEL_CHARS : MAX_PRICE_PER_MTOK,
                    })}
                </p>
            )}
        </li>
    );
}
