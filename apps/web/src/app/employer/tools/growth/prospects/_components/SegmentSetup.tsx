"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { prospectsApi, type NewSegmentInput } from "../api";
import { useProspects } from "../_lib/context";
import { SegmentForm } from "./SegmentForm";

/**
 * Prospects' first screen in a workspace with no segment. It used to be a
 * page with a disabled Find companies button; the only way forward was the
 * segment switcher's popover, then New segment, then four free-text fields
 * (countries as ISO codes). Now the three questions are on the page, drafted
 * from the company profile, and answering them starts the search.
 */
export function SegmentSetup() {
    const t = useTranslations("growth.prospects.setup");
    const { reloadSegments, setSegmentId, startRun } = useProspects();
    const [busy, setBusy] = useState(false);

    const createAndFind = async (input: NewSegmentInput) => {
        setBusy(true);
        try {
            const { segment } = await prospectsApi.createSegment(input);
            await reloadSegments();
            setSegmentId(segment.id);
            await startRun({ segmentId: segment.id });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("failed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="border-line bg-panel mx-auto w-full max-w-[640px] rounded-xl border p-5">
            <h2 className="text-ink text-lg font-semibold">{t("title")}</h2>
            <p className="text-ink-3 mt-1 mb-4 text-[13px]">{t("body")}</p>
            <SegmentForm
                idPrefix="setup"
                submitLabel={t("submit")}
                busy={busy}
                onSubmit={input => void createAndFind(input)}
                autoFocus
            />
        </section>
    );
}
