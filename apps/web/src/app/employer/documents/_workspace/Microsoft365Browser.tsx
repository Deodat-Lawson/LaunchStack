"use client";

/**
 * The built-in OneDrive and SharePoint browser: a dialog over Add source
 * that walks what the connected account can open and collects a selection.
 * Microsoft's own file picker needs a second app registration and a popup to
 * a tenant-specific address; this one reads through the workspace's existing
 * grant (`GET /api/connectors/microsoft-files/browse`), so it works wherever
 * the connection does.
 *
 * Two starting points: "My OneDrive" opens the account's own drive; and
 * "SharePoint sites" searches sites, then lists a site's document libraries,
 * then browses one like any folder. Folders open on click; the checkbox
 * beside a file or a folder selects it. The selection survives moving
 * around, so files from several folders can be added in one go.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ChevronRight, FileText, Folder, Globe, Library, Search } from "lucide-react";

import { IconOneDrive, IconSharePoint } from "~/components/icons/brand";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";

import {
    MICROSOFT_365_API,
    MICROSOFT_365_MAX_PICKS,
    microsoft365ErrorMessage,
    type Microsoft365Pick,
} from "./useMicrosoft365Source";

/** One row of a folder, as the browse route sends it. */
export interface BrowseItem {
    readonly driveId: string;
    readonly itemId: string;
    readonly kind: "file" | "folder";
    readonly name: string;
    readonly mimeType: string | null;
    readonly size: number | null;
    readonly modifiedAt: string | null;
    readonly webUrl: string | null;
    readonly supported: boolean;
}

interface BrowseSite {
    readonly siteId: string;
    readonly name: string;
    readonly webUrl: string | null;
}

interface BrowseDrive {
    readonly driveId: string;
    readonly name: string;
}

type Place = "onedrive" | "sharepoint";

/** Where the browser is; the trail of these is the breadcrumb. */
export type BrowseLocation =
    | { readonly kind: "onedrive" }
    | { readonly kind: "sites" }
    | { readonly kind: "site"; readonly siteId: string; readonly name: string }
    | {
          readonly kind: "folder";
          readonly driveId: string;
          /** Absent at the top of a drive. */
          readonly itemId?: string;
          readonly name: string;
      };

type Listing =
    | { readonly kind: "items"; readonly items: readonly BrowseItem[]; readonly truncated: boolean }
    | { readonly kind: "sites"; readonly sites: readonly BrowseSite[] }
    | { readonly kind: "libraries"; readonly drives: readonly BrowseDrive[] };

type View =
    | { readonly status: "loading" }
    | { readonly status: "error"; readonly message: string }
    | { readonly status: "ok"; readonly listing: Listing };

/** The browse route's address for a location. */
export function browseUrl(location: BrowseLocation, siteQuery: string): string {
    const params = new URLSearchParams();
    if (location.kind === "sites") params.set("sites", siteQuery);
    else if (location.kind === "site") params.set("siteId", location.siteId);
    else if (location.kind === "folder") {
        params.set("driveId", location.driveId);
        if (location.itemId) params.set("itemId", location.itemId);
    }
    const query = params.toString();
    return query ? `${MICROSOFT_365_API}/browse?${query}` : `${MICROSOFT_365_API}/browse`;
}

function listingFrom(location: BrowseLocation, data: Record<string, unknown>): Listing {
    if (location.kind === "sites") {
        return { kind: "sites", sites: (data.sites as BrowseSite[] | undefined) ?? [] };
    }
    if (location.kind === "site") {
        return { kind: "libraries", drives: (data.drives as BrowseDrive[] | undefined) ?? [] };
    }
    return {
        kind: "items",
        items: (data.items as BrowseItem[] | undefined) ?? [],
        truncated: data.truncated === true,
    };
}

const keyOf = (item: { driveId: string; itemId: string }) => `${item.driveId}:${item.itemId}`;

const START: Record<Place, BrowseLocation> = {
    onedrive: { kind: "onedrive" },
    sharepoint: { kind: "sites" },
};

const ROW =
    "border-line flex min-h-11 items-center gap-2.5 border-b px-3 py-2 text-[13px] last:border-b-0";
const ROW_BUTTON =
    "hover:bg-panel-2 focus-visible:ring-brand/50 -mx-1.5 flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1 text-left outline-none focus-visible:ring-[3px]";

export function Microsoft365Browser({
    open,
    onOpenChange,
    busy,
    onAdd,
}: {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    /** While the selection is being saved. */
    readonly busy: boolean;
    /** Saves the selection. Resolves to null once saved, or the reason it wasn't. */
    readonly onAdd: (picks: readonly Microsoft365Pick[]) => Promise<string | null>;
}) {
    const t = useTranslations("sources.microsoft365Source.browser");
    const tc = useTranslations("common");
    const format = useFormatter();
    const [place, setPlace] = useState<Place>("onedrive");
    const [trail, setTrail] = useState<readonly BrowseLocation[]>([START.onedrive]);
    const [view, setView] = useState<View>({ status: "loading" });
    const [draftQuery, setDraftQuery] = useState("");
    const [siteQuery, setSiteQuery] = useState("");
    const [attempt, setAttempt] = useState(0);
    const [selected, setSelected] = useState<ReadonlyMap<string, Microsoft365Pick>>(new Map());
    const [addError, setAddError] = useState<string | null>(null);

    const current = trail[trail.length - 1] ?? START[place];

    // Opening starts over: the last visit's place and picks are not this one's.
    useEffect(() => {
        if (!open) return;
        setPlace("onedrive");
        setTrail([START.onedrive]);
        setDraftQuery("");
        setSiteQuery("");
        setSelected(new Map());
        setAddError(null);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setView({ status: "loading" });
        void (async () => {
            try {
                const res = await fetch(browseUrl(current, siteQuery));
                if (cancelled) return;
                if (!res.ok) {
                    const message = await microsoft365ErrorMessage(res, t("loadFailed"));
                    if (!cancelled) setView({ status: "error", message });
                    return;
                }
                const payload = (await res.json()) as { data?: Record<string, unknown> };
                if (cancelled) return;
                setView({ status: "ok", listing: listingFrom(current, payload.data ?? {}) });
            } catch {
                if (!cancelled) setView({ status: "error", message: t("loadFailed") });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, current, siteQuery, attempt, t]);

    const switchPlace = useCallback((next: string) => {
        const target: Place = next === "sharepoint" ? "sharepoint" : "onedrive";
        setPlace(target);
        setTrail([START[target]]);
    }, []);

    const enter = useCallback((location: BrowseLocation) => {
        setTrail(prev => [...prev, location]);
    }, []);

    const atLimit = selected.size >= MICROSOFT_365_MAX_PICKS;

    const toggle = useCallback((item: BrowseItem) => {
        setAddError(null);
        setSelected(prev => {
            const next = new Map(prev);
            const key = keyOf(item);
            if (next.has(key)) next.delete(key);
            else if (next.size < MICROSOFT_365_MAX_PICKS) {
                next.set(key, {
                    driveId: item.driveId,
                    itemId: item.itemId,
                    kind: item.kind,
                    name: item.name,
                });
            }
            return next;
        });
    }, []);

    const submit = async () => {
        if (selected.size === 0) return;
        setAddError(null);
        const failed = await onAdd([...selected.values()]);
        if (failed) setAddError(failed);
        else onOpenChange(false);
    };

    const crumbLabel = useCallback(
        (location: BrowseLocation) =>
            location.kind === "onedrive"
                ? t("myOneDrive")
                : location.kind === "sites"
                  ? t("sites")
                  : location.name,
        [t]
    );

    const body = useMemo(() => {
        if (view.status === "loading") {
            return (
                <div className="text-ink-3 flex items-center gap-2 px-3 py-6 text-[13px]">
                    <Spinner /> {t("loading")}
                </div>
            );
        }
        if (view.status === "error") {
            return (
                <div className="px-3 py-6">
                    <p className="text-danger mb-2 text-[13px]" role="alert">
                        {view.message}
                    </p>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setAttempt(n => n + 1)}
                    >
                        {t("retry")}
                    </Button>
                </div>
            );
        }
        const listing = view.listing;
        if (listing.kind === "sites") {
            if (listing.sites.length === 0) {
                return <p className="text-ink-3 px-3 py-6 text-[13px]">{t("noSites")}</p>;
            }
            return (
                <ul>
                    {listing.sites.map(site => (
                        <li key={site.siteId} className={ROW}>
                            <button
                                type="button"
                                className={ROW_BUTTON}
                                onClick={() =>
                                    enter({ kind: "site", siteId: site.siteId, name: site.name })
                                }
                            >
                                <Globe className="text-ink-3 size-4 shrink-0" aria-hidden />
                                <span className="text-ink min-w-0 flex-1 truncate">
                                    {site.name}
                                </span>
                                <span className="text-ink-3 shrink-0 text-xs">{t("site")}</span>
                                <ChevronRight className="text-ink-4 size-4 shrink-0" aria-hidden />
                            </button>
                        </li>
                    ))}
                </ul>
            );
        }
        if (listing.kind === "libraries") {
            if (listing.drives.length === 0) {
                return <p className="text-ink-3 px-3 py-6 text-[13px]">{t("noLibraries")}</p>;
            }
            return (
                <ul>
                    {listing.drives.map(drive => (
                        <li key={drive.driveId} className={ROW}>
                            <button
                                type="button"
                                className={ROW_BUTTON}
                                onClick={() =>
                                    enter({
                                        kind: "folder",
                                        driveId: drive.driveId,
                                        name: drive.name,
                                    })
                                }
                            >
                                <Library className="text-ink-3 size-4 shrink-0" aria-hidden />
                                <span className="text-ink min-w-0 flex-1 truncate">
                                    {drive.name}
                                </span>
                                <span className="text-ink-3 shrink-0 text-xs">{t("library")}</span>
                                <ChevronRight className="text-ink-4 size-4 shrink-0" aria-hidden />
                            </button>
                        </li>
                    ))}
                </ul>
            );
        }
        if (listing.items.length === 0) {
            return <p className="text-ink-3 px-3 py-6 text-[13px]">{t("emptyFolder")}</p>;
        }
        return (
            <>
                <ul>
                    {listing.items.map(item => {
                        const key = keyOf(item);
                        const checked = selected.has(key);
                        const disabled = !item.supported || (!checked && atLimit);
                        const modified = item.modifiedAt
                            ? format.dateTime(new Date(item.modifiedAt), { dateStyle: "medium" })
                            : null;
                        const label = (
                            <>
                                {item.kind === "folder" ? (
                                    <Folder className="text-brand size-4 shrink-0" aria-hidden />
                                ) : (
                                    <FileText className="text-ink-3 size-4 shrink-0" aria-hidden />
                                )}
                                <span
                                    className={`min-w-0 flex-1 truncate ${item.supported ? "text-ink" : "text-ink-3"}`}
                                >
                                    {item.name}
                                </span>
                                <span className="text-ink-3 shrink-0 text-xs">
                                    {item.supported ? modified : t("unsupported")}
                                </span>
                            </>
                        );
                        return (
                            <li key={key} className={ROW} data-testid="m365-browse-row">
                                <Checkbox
                                    checked={checked}
                                    disabled={disabled}
                                    onCheckedChange={() => toggle(item)}
                                    aria-label={t("selectItem", { name: item.name })}
                                />
                                {item.kind === "folder" ? (
                                    <button
                                        type="button"
                                        className={ROW_BUTTON}
                                        aria-label={t("openItem", { name: item.name })}
                                        onClick={() =>
                                            enter({
                                                kind: "folder",
                                                driveId: item.driveId,
                                                itemId: item.itemId,
                                                name: item.name,
                                            })
                                        }
                                    >
                                        {label}
                                        <ChevronRight
                                            className="text-ink-4 size-4 shrink-0"
                                            aria-hidden
                                        />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className={ROW_BUTTON}
                                        disabled={disabled}
                                        tabIndex={-1}
                                        aria-hidden
                                        onClick={() => toggle(item)}
                                    >
                                        {label}
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
                {listing.truncated ? (
                    <p className="text-ink-3 px-3 py-2 text-xs">
                        {t("truncated", { count: listing.items.length })}
                    </p>
                ) : null}
            </>
        );
    }, [view, selected, atLimit, enter, toggle, format, t]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="z-[110] gap-3 sm:max-w-[640px]"
                overlayClassName="z-[110]"
                data-testid="m365-browser"
            >
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>{t("description")}</DialogDescription>
                </DialogHeader>

                <Tabs value={place} onValueChange={switchPlace}>
                    <TabsList>
                        <TabsTrigger value="onedrive">
                            <IconOneDrive size={16} />
                            {t("myOneDrive")}
                        </TabsTrigger>
                        <TabsTrigger value="sharepoint">
                            <IconSharePoint size={16} />
                            {t("sites")}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>

                <nav aria-label={t("location")} className="min-w-0">
                    <ol className="text-ink-3 flex flex-wrap items-center gap-1 text-[13px]">
                        {trail.map((location, index) => {
                            const last = index === trail.length - 1;
                            return (
                                <li
                                    key={`${index}:${crumbLabel(location)}`}
                                    className="flex min-w-0 items-center gap-1"
                                >
                                    {index > 0 ? (
                                        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                                    ) : null}
                                    {last ? (
                                        <span
                                            className="text-ink max-w-[220px] truncate font-semibold"
                                            aria-current="page"
                                        >
                                            {crumbLabel(location)}
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            className="hover:text-ink focus-visible:ring-brand/50 max-w-[180px] truncate rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-[3px]"
                                            onClick={() => setTrail(trail.slice(0, index + 1))}
                                        >
                                            {crumbLabel(location)}
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ol>
                </nav>

                {current.kind === "sites" ? (
                    <form
                        className="flex gap-2"
                        role="search"
                        onSubmit={event => {
                            event.preventDefault();
                            setSiteQuery(draftQuery.trim());
                        }}
                    >
                        <div className="relative min-w-0 flex-1">
                            <Search
                                className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
                                aria-hidden
                            />
                            <Input
                                value={draftQuery}
                                onChange={event => setDraftQuery(event.target.value)}
                                placeholder={t("searchSites")}
                                aria-label={t("searchSites")}
                                className="pl-8"
                                autoComplete="off"
                            />
                        </div>
                        <Button type="submit" variant="outline">
                            {t("search")}
                        </Button>
                    </form>
                ) : null}

                <div
                    className="border-line bg-panel h-[320px] overflow-y-auto rounded-lg border"
                    aria-busy={view.status === "loading"}
                >
                    {body}
                </div>

                {addError ? (
                    <p className="text-danger text-[13px]" role="alert">
                        {addError}
                    </p>
                ) : atLimit ? (
                    <p className="text-ink-3 text-xs">
                        {t("limit", { max: MICROSOFT_365_MAX_PICKS })}
                    </p>
                ) : null}

                <DialogFooter className="items-center">
                    <span className="text-ink-3 mr-auto text-[13px]" aria-live="polite">
                        {t("selected", { count: selected.size })}
                    </span>
                    {selected.size > 0 ? (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setSelected(new Map())}
                        >
                            {t("clear")}
                        </Button>
                    ) : null}
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        {tc("actions.cancel")}
                    </Button>
                    <Button
                        type="button"
                        disabled={busy || selected.size === 0}
                        onClick={() => void submit()}
                    >
                        {t("addSelected", { count: selected.size })}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
