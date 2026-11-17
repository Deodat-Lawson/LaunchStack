"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useErrorText } from "~/lib/tools/errorText";

import type { ProgramView } from "../api";
import { useAccelerators } from "../_lib/context";

/**
 * Scores this one Program from its own page, at the per-Program rate shown on the
 * button. A Program never scored or out of date is scored; a current result is
 * scored again only from here, where asking for it is explicit. Progress shows in
 * the run status above the page, and the fit panel updates when the run saves.
 */
export function ScoreProgramButton({ view }: { view: ProgramView }) {
    const t = useTranslations("accelerators.scoring");
    const tc = useTranslations("accelerators");
    const format = useFormatter();
    const errorText = useErrorText();
    const { home, runBusy, match } = useAccelerators();
    const [pending, setPending] = useState(false);
    const pendingRef = useRef(false);
    const [failure, setFailure] = useState<unknown>(null);
    if (!home) return null;

    const status = view.freshness.status;
    const current = status === "current";
    const credits = format.number(home.costs.matchPerProgram);
    const label = t(status === "not_assessed" ? "scoreOne" : current ? "rescoreOne" : "updateOne", {
        credits,
    });
    const reason = !home.canEdit
        ? tc("common.readOnly")
        : !home.profileReady
          ? tc("home.profileMissing")
          : runBusy
            ? t("running")
            : null;
    const busy = pending || runBusy;

    const start = async () => {
        if (pendingRef.current || reason) return;
        pendingRef.current = true;
        setPending(true);
        setFailure(null);
        try {
            await match([view.program.id], current);
        } catch (error) {
            setFailure(error);
        } finally {
            pendingRef.current = false;
            setPending(false);
        }
    };

    const button = (
        <Button
            type="button"
            size="sm"
            variant={status === "not_assessed" ? "default" : "outline"}
            className="w-full"
            disabled={reason !== null || pending}
            onClick={() => void start()}
        >
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Sparkles />}
            {busy ? t("scoringOne") : label}
        </Button>
    );

    return (
        <div className="space-y-1.5">
            {reason !== null ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span tabIndex={0} className="block">
                            {button}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-64">{reason}</TooltipContent>
                </Tooltip>
            ) : (
                button
            )}
            {failure != null && (
                <p role="alert" className="text-danger text-xs">
                    {errorText(failure, tc("common.actionFailed"))}
                </p>
            )}
        </div>
    );
}
