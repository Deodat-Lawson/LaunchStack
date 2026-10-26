"use client";

/**
 * The always-there way in while the product is in testing: a small pill in
 * the bottom-right corner. It opens a short menu rather than the dialog
 * straight away, because the second most useful thing after "report" is
 * "what happened to what I reported?".
 *
 * Hiding it is per person and per browser, and only hides the pill: the
 * account menu, ⌘K and the shortcut still open the dialog, and the Feedback
 * tab can bring the pill back.
 */

import { useCallback, useSyncExternalStore } from "react";
import { Bug, EyeOff, Inbox, Lightbulb, MessageSquareText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { FEEDBACK_TOOL_ID, type FeedbackKind } from "~/lib/feedback/contract";
import { toolTabHref } from "~/lib/tool-app/locations";

import { feedbackKeys } from "./keys";

const HIDDEN_KEY = "feedback.launcher.hidden.v1";
const listeners = new Set<() => void>();

function readHidden(): boolean {
    try {
        return window.localStorage.getItem(HIDDEN_KEY) === "1";
    } catch {
        return false;
    }
}

function writeHidden(hidden: boolean) {
    try {
        if (hidden) window.localStorage.setItem(HIDDEN_KEY, "1");
        else window.localStorage.removeItem(HIDDEN_KEY);
    } catch {
        // Storage refused (private window): it stays shown, which is fine.
    }
    listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
        if (event.key === HIDDEN_KEY) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
    };
}

/** Whether this person hid the pill, shared by every place that can change it. */
export function useLauncherHidden(): [boolean, (hidden: boolean) => void] {
    // Hidden on the server and in the first client render, so the pill never
    // flashes in for someone who hid it.
    const hidden = useSyncExternalStore(subscribe, readHidden, () => true);
    return [hidden, useCallback((next: boolean) => writeHidden(next), [])];
}

export function FeedbackLauncher({
    onOpen,
    onHide,
    onUnhide,
}: {
    onOpen: (kind: FeedbackKind) => void;
    onHide: () => void;
    onUnhide: () => void;
}) {
    const t = useTranslations("feedback.launcher");
    const tEntry = useTranslations("feedback.entry");
    const router = useRouter();

    const hide = () => {
        onHide();
        toast(t("hiddenToast"), {
            description: t("hiddenToastBody", feedbackKeys()),
            action: { label: t("undo"), onClick: onUnhide },
        });
    };

    return (
        <div
            data-feedback-capture="skip"
            className="pointer-events-none fixed bottom-4 right-4 z-40 print:hidden"
        >
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        data-testid="feedback-launcher"
                        aria-label={t("label")}
                        className="border-line bg-surface text-ink-2 hover:text-ink hover:border-brand focus-visible:ring-brand/50 pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium shadow-md outline-none transition-colors focus-visible:ring-[3px]"
                    >
                        <MessageSquareText className="text-brand size-3.5" aria-hidden />
                        {t("button")}
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    side="top"
                    align="end"
                    className="w-56"
                    data-feedback-capture="skip"
                >
                    <DropdownMenuItem onSelect={() => onOpen("bug")}>
                        <Bug aria-hidden />
                        {tEntry("reportBug")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onOpen("idea")}>
                        <Lightbulb aria-hidden />
                        {tEntry("requestFeature")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() => router.push(toolTabHref(FEEDBACK_TOOL_ID, "/mine"))}
                    >
                        <Inbox aria-hidden />
                        {tEntry("myReports")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={hide} data-testid="feedback-launcher-hide">
                        <EyeOff aria-hidden />
                        {t("hide")}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
