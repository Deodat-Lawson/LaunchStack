"use client";

import { Check, Loader2, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { useErrorText } from "~/lib/tools/errorText";
import { cn } from "~/lib/utils";

import { runIsLive, useAccelerators } from "../_lib/context";

export function RunStatus() {
    const t = useTranslations("accelerators.run");
    const format = useFormatter();
    const errorText = useErrorText();
    const { activeRun: run, pollError, resumePolling } = useAccelerators();
    if (!run && !pollError) return null;
    return (
        <section
            aria-live="polite"
            className="border-line bg-panel space-y-3 rounded-xl border p-4"
        >
            {run && (
                <>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <div className="flex items-center gap-2 font-medium">
                            {runIsLive(run) ? (
                                <Loader2 className="text-brand size-4 animate-spin motion-reduce:animate-none" />
                            ) : run.status === "completed" ? (
                                <Check className="text-success size-4" />
                            ) : (
                                <X className="text-danger size-4" />
                            )}
                            <span>{t(run.kind === "programs" ? "programs" : "draft")}</span>
                            <span className="text-ink-3 font-normal">{t(run.status)}</span>
                        </div>
                        {run.creditsUsed > 0 && (
                            <span className="text-ink-3 text-xs tabular-nums">
                                {t("credits", { credits: format.number(run.creditsUsed) })}
                            </span>
                        )}
                    </div>
                    {run.steps.length > 0 && (
                        <ol className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                            {run.steps.map(step => (
                                <li
                                    key={step.id}
                                    className={cn(
                                        "text-ink-3 flex items-center gap-2",
                                        step.status === "running" && "text-brand",
                                        step.status === "failed" && "text-danger"
                                    )}
                                >
                                    {step.status === "running" && (
                                        <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                                    )}
                                    {step.status === "done" && <Check className="size-3" />}
                                    <span>{t(step.id === "save" ? "save" : "generate")}</span>
                                    <span>{t(step.status)}</span>
                                </li>
                            ))}
                        </ol>
                    )}
                    {run.error && (
                        <p role="alert" className="text-danger text-sm">
                            {run.error}
                        </p>
                    )}
                </>
            )}
            {pollError != null && (
                <div
                    role="alert"
                    className="text-danger flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                    <span>{errorText(pollError, t("pollFailed"))}</span>
                    <Button type="button" variant="outline" size="sm" onClick={resumePolling}>
                        {t("resume")}
                    </Button>
                </div>
            )}
        </section>
    );
}
