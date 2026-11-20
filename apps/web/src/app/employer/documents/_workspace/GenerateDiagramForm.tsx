"use client";

import React, { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";

/** The kinds the generator draws; "auto" lets the model pick from the description. */
const KINDS = ["auto", "mindmap", "flowchart", "org_chart", "tree"] as const;
type Kind = (typeof KINDS)[number];

/** Read the app's lighting once, at submit: the board is seeded in it (see the Mindmap README). */
function appMode(): "light" | "dark" {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

/**
 * "Describe it and AI draws it" — the top of the New mindmap gallery.
 *
 * Posts the description to `/api/mindmaps/generate`, which has the
 * workspace's model write the diagram and saves it as a draft in `folder`
 * (the person's Private section when none), then opens it in the editor like
 * a template would. ⌘/Ctrl+Enter submits.
 */
export function GenerateDiagramForm({
    folder,
    disabled = false,
    onBusyChange,
    onCreated,
}: {
    folder: string;
    disabled?: boolean;
    onBusyChange?: (busy: boolean) => void;
    onCreated: (mindmapId: number) => void;
}) {
    const t = useTranslations("sources.addSourceModal.mindmap.generate");
    const promptId = useId();
    const [prompt, setPrompt] = useState("");
    const [kind, setKind] = useState<Kind>("auto");
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        const text = prompt.trim();
        if (!text || busy) return;
        setBusy(true);
        onBusyChange?.(true);
        try {
            const res = await fetch("/api/mindmaps/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: text,
                    folder,
                    mode: appMode(),
                    ...(kind === "auto" ? {} : { type: kind }),
                }),
            });
            const body = (await res.json().catch(() => ({}))) as {
                error?: string;
                mindmap?: { id: number };
            };
            if (!res.ok || !body.mindmap) throw new Error(body.error ?? t("failed"));
            onCreated(body.mindmap.id);
        } catch (error) {
            toast.error(error instanceof Error && error.message ? error.message : t("failed"));
            setBusy(false);
            onBusyChange?.(false);
        }
    };

    return (
        <form
            className="border-line bg-panel mb-4 rounded-[10px] border p-3"
            onSubmit={event => {
                event.preventDefault();
                void submit();
            }}
        >
            <Label
                htmlFor={promptId}
                className="text-ink mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold"
            >
                <Sparkles className="text-brand size-3.5" aria-hidden />
                {t("label")}
            </Label>
            <Textarea
                id={promptId}
                value={prompt}
                onChange={event => setPrompt(event.target.value)}
                onKeyDown={event => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        void submit();
                    }
                }}
                placeholder={t("placeholder")}
                rows={3}
                maxLength={4000}
                disabled={busy || disabled}
                className="min-h-[72px] resize-none text-[13px]"
            />
            <div className="mt-2 flex items-center gap-2">
                <Select
                    value={kind}
                    onValueChange={value => setKind(value as Kind)}
                    disabled={busy || disabled}
                >
                    <SelectTrigger
                        size="sm"
                        className="w-[150px] text-xs"
                        aria-label={t("kindLabel")}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {KINDS.map(k => (
                            <SelectItem key={k} value={k} className="text-xs">
                                {t(`kinds.${k}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <span className="text-ink-3 min-w-0 flex-1 truncate text-[11.5px]">
                    {busy ? t("drawingHint") : t("hint")}
                </span>
                <Button type="submit" size="sm" disabled={!prompt.trim() || busy || disabled}>
                    {busy ? (
                        <Spinner className="size-3.5" />
                    ) : (
                        <Sparkles className="size-3.5" aria-hidden />
                    )}
                    {busy ? t("drawing") : t("generate")}
                </Button>
            </div>
        </form>
    );
}
