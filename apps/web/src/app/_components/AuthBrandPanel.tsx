"use client";

import React from "react";
import { FileSearch, MessagesSquare, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Launchstack auth-side brand panel.
 *
 * Used by /signin and /signup as the right-hand panel next to the auth form.
 * Tone is tuned for solo founders, indie developers, and students — not the
 * enterprise "5k documents / 50+ companies / bank-level security" pitch.
 *
 * `note` is a short fact line under the description ("Free · open source"),
 * not a label above the headline: the headline carries its own weight.
 */
export function AuthBrandPanel({
    headline,
    description,
    note,
}: {
    headline: string;
    description: string;
    note?: string;
}) {
    const t = useTranslations("auth.brandPanel");
    return (
        <div className="bg-panel-2 border-line relative flex min-w-0 flex-1 flex-col justify-center overflow-hidden border-l px-14 py-16">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-50"
                style={{
                    background:
                        "radial-gradient(circle at 15% 20%, var(--accent-glow) 0%, transparent 55%)",
                }}
            />
            <div className="relative max-w-[480px]">
                <h2 className="display text-ink m-0 text-[44px] leading-[1.05] tracking-[-0.025em]">
                    {headline}
                </h2>
                <p className="text-ink-3 mb-0 mt-3.5 max-w-[420px] text-[15px] leading-[1.6]">
                    {description}
                </p>
                {note && <p className="text-brand-ink mb-0 mt-3 text-[13px] font-medium">{note}</p>}

                <div className="mt-9 flex flex-col gap-4">
                    <BrandFeature
                        Icon={FileSearch}
                        title={t("features.grounded.title")}
                        text={t("features.grounded.text")}
                    />
                    <BrandFeature
                        Icon={Sparkles}
                        title={t("features.onePlace.title")}
                        text={t("features.onePlace.text")}
                    />
                    <BrandFeature
                        Icon={MessagesSquare}
                        title={t("features.solo.title")}
                        text={t("features.solo.text")}
                    />
                </div>

                <figure className="border-line text-ink-3 m-0 mt-11 border-t pt-5 text-xs leading-[1.6]">
                    <blockquote className="m-0 italic">{t("quote")}</blockquote>
                    <figcaption className="text-ink-3 mt-1.5 text-[11px]">
                        {t("quoteAttribution")}
                    </figcaption>
                </figure>
            </div>
        </div>
    );
}

function BrandFeature({
    Icon,
    title,
    text,
}: {
    Icon: React.ComponentType<{ className?: string }>;
    title: string;
    text: string;
}) {
    return (
        <div className="flex items-start gap-3">
            <div className="bg-brand-soft text-brand-ink mt-px flex size-8 shrink-0 items-center justify-center rounded-[9px]">
                <Icon className="size-4" />
            </div>
            <div>
                <div className="text-ink text-[13px] font-semibold">{title}</div>
                <div className="text-ink-3 mt-[3px] text-[12.5px] leading-[1.55]">{text}</div>
            </div>
        </div>
    );
}
