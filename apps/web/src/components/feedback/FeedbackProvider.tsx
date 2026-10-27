"use client";

/**
 * One feedback dialog for every signed-in page, and the ways to open it.
 *
 * Mounted by the `/employer` and `/workspaces` layouts. It asks the server
 * once whether this instance takes reports at all (`/api/feedback/me`: an
 * operator must be named in `FEEDBACK_ADMIN_EMAILS`, or nobody would read
 * them) and renders nothing until it does. Then:
 *
 * - the floating Feedback button, unless this person hid it;
 * - "Report a bug" and "Request a feature" in ⌘K and the right-click menu;
 * - `useFeedback().open()` for everything else — the account menu, the
 *   keyboard shortcut, an error screen, a failed source.
 *
 * The draft lives here, not in the dialog, so closing the dialog by accident
 * (Escape, a click outside) keeps what was typed until it is sent.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { useRegisterActions } from "~/components/context-menu";
import { fetchFeedbackAccess } from "~/lib/feedback/api";
import type { FeedbackAccess, FeedbackKind } from "~/lib/feedback/contract";
import { installRecentErrors } from "~/lib/feedback/recent-errors";
import { APP_TARGET_KIND } from "~/lib/context-menu";

import { emptyDraft, type FeedbackDraft } from "./draft";
import { FeedbackDialog } from "./FeedbackDialog";
import { FeedbackLauncher, useLauncherHidden } from "./FeedbackLauncher";

// Listen from the first import, so errors before the dialog opens are kept.
installRecentErrors();

export interface FeedbackOpenOptions {
    kind?: FeedbackKind;
    title?: string;
    body?: string;
    /** What prefilled it: an error screen's digest, a failed source's job id. */
    origin?: Record<string, string>;
}

export interface FeedbackApi {
    /** Null until the server has answered. */
    access: FeedbackAccess | null;
    /** The instance takes reports: show the entry points. */
    enabled: boolean;
    open: (options?: FeedbackOpenOptions) => void;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

const DISABLED: FeedbackApi = { access: null, enabled: false, open: () => undefined };

/** The feedback dialog, or a no-op outside a page that mounts it. */
export function useFeedback(): FeedbackApi {
    return useContext(FeedbackContext) ?? DISABLED;
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
    const [access, setAccess] = useState<FeedbackAccess | null>(null);
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<FeedbackDraft>(() => emptyDraft());
    const [launcherHidden, setLauncherHidden] = useLauncherHidden();

    useEffect(() => {
        let cancelled = false;
        fetchFeedbackAccess()
            .then(a => {
                if (!cancelled) setAccess(a);
            })
            .catch(() => {
                // Signed out, or an instance without the routes: no reporter.
                if (!cancelled) setAccess({ enabled: false, triager: false });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const enabled = access?.enabled === true;

    const openDialog = useCallback(
        (options: FeedbackOpenOptions = {}) => {
            if (!enabled) return;
            setDraft(current => {
                const prefilled = options.title !== undefined || options.body !== undefined;
                // A prefilled report (from an error) starts fresh; a plain
                // "open" keeps whatever was typed last time, switching kind
                // only when asked to.
                if (prefilled) {
                    current.images.forEach(image => URL.revokeObjectURL(image.url));
                    return {
                        ...emptyDraft(options.kind ?? current.kind),
                        title: options.title ?? "",
                        body: options.body ?? "",
                        origin: options.origin,
                    };
                }
                const kind = options.kind ?? current.kind;
                return kind === current.kind
                    ? current
                    : { ...current, kind, technical: kind === "bug" };
            });
            setOpen(true);
        },
        [enabled]
    );

    const t = useTranslations("feedback.entry");
    useRegisterActions(
        useMemo(
            () =>
                enabled
                    ? [
                          {
                              id: "app.feedback.bug",
                              label: t("reportBug"),
                              icon: "bug" as const,
                              order: 80,
                              appliesTo: target => target.kind === APP_TARGET_KIND,
                              run: () => openDialog({ kind: "bug" }),
                          },
                          {
                              id: "app.feedback.idea",
                              label: t("requestFeature"),
                              icon: "idea" as const,
                              order: 81,
                              appliesTo: target => target.kind === APP_TARGET_KIND,
                              run: () => openDialog({ kind: "idea" }),
                          },
                      ]
                    : [],
            [enabled, openDialog, t]
        )
    );

    const api = useMemo<FeedbackApi>(
        () => ({ access, enabled, open: openDialog }),
        [access, enabled, openDialog]
    );

    return (
        <FeedbackContext.Provider value={api}>
            {children}
            {enabled && (
                <>
                    <FeedbackDialog
                        open={open}
                        onOpenChange={setOpen}
                        draft={draft}
                        onDraftChange={setDraft}
                    />
                    {!launcherHidden && (
                        <FeedbackLauncher
                            onOpen={kind => openDialog({ kind })}
                            onHide={() => setLauncherHidden(true)}
                            onUnhide={() => setLauncherHidden(false)}
                        />
                    )}
                </>
            )}
        </FeedbackContext.Provider>
    );
}
