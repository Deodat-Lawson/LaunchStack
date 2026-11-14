"use client";

/**
 * Add source's "OneDrive and SharePoint" tab (see useMicrosoft365Source).
 * What is picked goes to the folder in the destination bar above it and
 * stays in sync with Microsoft 365.
 *
 * States: loading → forbidden (the connection is the workspace's; a member
 * is told who to ask) → not configured (which variables the server needs) →
 * not connected (Connect) → revoked (Reconnect) → connected (the account,
 * Browse, paste a link). What already syncs is managed in Settings ›
 * Integrations (Microsoft365SyncPanel).
 */

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, FolderSearch, Link2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { IconMicrosoft } from "~/components/icons/brand";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { microsoft365LinkFrom } from "~/lib/integrations/microsoft-365-link";

import { Microsoft365Browser } from "./Microsoft365Browser";
import {
    MICROSOFT_365_CONNECT_URL,
    useMicrosoft365Source,
    type Microsoft365Added,
} from "./useMicrosoft365Source";

/** What connecting gives, as keys in `sources.microsoft365Source.perks`. */
const PERKS = ["pick", "sync", "readOnly"] as const;

type SourceTranslator = ReturnType<typeof useTranslations<"sources.microsoft365Source">>;

function addedToast(t: SourceTranslator, added: readonly Microsoft365Added[]) {
    const [first] = added;
    if (added.length === 1 && first) {
        toast.success(
            first.kind === "folder"
                ? t("addedFolder", { name: first.name })
                : t("addedOne", { name: first.name })
        );
    } else {
        toast.success(t("addedMany", { count: added.length }));
    }
}

export function Microsoft365SourcePanel({
    destination,
    onAdded,
    onSynced,
}: {
    /** The folder the destination bar shows. */
    readonly destination: string;
    /** Something was added: the dialog closes and the queue opens. */
    readonly onAdded: () => void;
    /** The picks have landed, seconds later: the workspace refreshes its list. */
    readonly onSynced?: () => void;
}) {
    const t = useTranslations("sources.microsoft365Source");
    const source = useMicrosoft365Source({ onSynced });
    const state = source.state;
    const [browsing, setBrowsing] = useState(false);
    const [link, setLink] = useState("");
    const [linkError, setLinkError] = useState<string | null>(null);

    const submitLink = async () => {
        const value = link.trim();
        if (!microsoft365LinkFrom(value)) {
            setLinkError(t("notMicrosoftLink"));
            return;
        }
        setLinkError(null);
        const result = await source.addLink(value, destination);
        if (!result.ok) {
            setLinkError(result.message);
            return;
        }
        addedToast(t, result.added);
        setLink("");
        onAdded();
    };

    const connected = state.kind === "ready" || state.kind === "reconnect";

    return (
        <div data-testid="m365-source" data-state={state.kind}>
            <div className="bg-line-2 mb-4 flex items-center gap-3.5 rounded-xl px-4 py-4">
                <div className="border-line bg-panel text-ink flex size-11 items-center justify-center rounded-[10px] border">
                    <IconMicrosoft size={22} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-ink text-[15px] font-semibold">{t("title")}</div>
                    <div className="text-ink-3 text-[13px]">{t("subtitle")}</div>
                </div>
            </div>

            {!connected && (
                <ul className="mb-4 flex flex-col gap-2.5">
                    {PERKS.map(perk => (
                        <li key={perk} className="text-ink-2 flex items-center gap-2.5 text-[13px]">
                            <Check className="text-brand size-3.5 shrink-0" aria-hidden />
                            {t(`perks.${perk}`)}
                        </li>
                    ))}
                </ul>
            )}

            {state.kind === "loading" && (
                <div className="text-ink-3 flex items-center gap-2 text-[13px]">
                    <Spinner /> {t("checking")}
                </div>
            )}

            {state.kind === "forbidden" && (
                <p className="text-ink-2 text-[13px] leading-relaxed">{t("forbidden")}</p>
            )}

            {state.kind === "error" && (
                <p className="text-danger text-[13px]" role="alert">
                    {t("loadError")}
                </p>
            )}

            {state.kind === "not-configured" && (
                <p className="text-ink-2 text-[13px] leading-relaxed">
                    {t.rich("notConfigured", {
                        code: chunks => (
                            <code className="bg-panel-2 text-ink rounded px-1 py-0.5 font-mono text-[12px]">
                                {chunks}
                            </code>
                        ),
                    })}
                </p>
            )}

            {state.kind === "connect" && (
                <>
                    <Button asChild className="w-full">
                        <a href={MICROSOFT_365_CONNECT_URL}>
                            <IconMicrosoft size={16} />
                            {t("connect")}
                        </a>
                    </Button>
                    <p className="text-ink-3 mt-2.5 text-xs leading-relaxed">{t("connectHint")}</p>
                </>
            )}

            {state.kind === "reconnect" && (
                <div className="border-warn bg-warn-soft text-ink flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed">
                    <TriangleAlert className="text-warn-ink mt-0.5 size-4 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                        <div className="font-semibold">{t("reconnectTitle")}</div>
                        {state.accountEmail ? (
                            <div className="text-ink-2 truncate text-xs">{state.accountEmail}</div>
                        ) : null}
                        <p className="mt-1">{t("reconnectBody")}</p>
                        <Button asChild size="sm" className="mt-2.5">
                            <a href={MICROSOFT_365_CONNECT_URL}>{t("reconnect")}</a>
                        </Button>
                    </div>
                </div>
            )}

            {state.kind === "ready" && (
                <>
                    <div className="border-line bg-panel mb-4 flex flex-wrap items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px]">
                        <Check className="text-brand size-4 shrink-0" aria-hidden />
                        <span className="text-ink min-w-0 flex-1 truncate font-semibold">
                            {state.accountEmail
                                ? t("connectedAs", { account: state.accountEmail })
                                : t("connectedFallback")}
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <Button
                            type="button"
                            disabled={source.busy}
                            onClick={() => setBrowsing(true)}
                        >
                            <FolderSearch aria-hidden />
                            {t("browse")}
                        </Button>
                        <span className="text-ink-3 text-xs">{t("browseHint")}</span>
                    </div>

                    <form
                        className="mt-5"
                        onSubmit={event => {
                            event.preventDefault();
                            void submitLink();
                        }}
                    >
                        <label
                            htmlFor="m365-link"
                            className="text-ink-3 mb-1.5 block text-xs font-semibold"
                        >
                            {t("pasteLinkLabel")}
                        </label>
                        <div className="flex gap-2 max-sm:flex-col">
                            <div className="relative min-w-0 flex-1">
                                <Link2
                                    className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
                                    aria-hidden
                                />
                                <Input
                                    id="m365-link"
                                    value={link}
                                    onChange={event => {
                                        setLink(event.target.value);
                                        setLinkError(null);
                                    }}
                                    // An address, not words: the same in every language.
                                    placeholder="https://contoso.sharepoint.com/…"
                                    aria-invalid={linkError ? true : undefined}
                                    aria-describedby={
                                        linkError ? "m365-link-error" : "m365-link-hint"
                                    }
                                    className="pl-8"
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>
                            <Button
                                type="submit"
                                variant="outline"
                                disabled={source.busy || !link.trim()}
                            >
                                {source.busy ? t("adding") : t("add")}
                            </Button>
                        </div>
                        {linkError ? (
                            <p id="m365-link-error" className="text-danger mt-1.5 text-xs">
                                {linkError}
                            </p>
                        ) : (
                            <p id="m365-link-hint" className="text-ink-3 mt-1.5 text-xs">
                                {state.accountEmail
                                    ? t("linkHintAccount", { account: state.accountEmail })
                                    : t("linkHintThis")}
                            </p>
                        )}
                    </form>

                    <p className="text-ink-3 mt-5 text-xs leading-relaxed">
                        {t("destinationHint")} {t("manageHint")}
                    </p>

                    <Microsoft365Browser
                        open={browsing}
                        onOpenChange={setBrowsing}
                        busy={source.busy}
                        onAdd={async picks => {
                            const result = await source.addItems(picks, destination);
                            if (!result.ok) return result.message;
                            addedToast(t, result.added);
                            onAdded();
                            return null;
                        }}
                    />
                </>
            )}
        </div>
    );
}
