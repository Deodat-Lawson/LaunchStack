"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";

import { prospectsApi, type NewSegmentInput } from "../api";
import { useErrorText } from "~/lib/tools/errorText";
import { useProspects } from "../_lib/context";
import { SegmentForm } from "./SegmentForm";

/**
 * Another segment, from the switcher: the same three questions as the first
 * one on Home (who buys, where, what you sell), drafted from the company
 * profile, with places typed as people write them.
 */
export function NewSegmentDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const t = useTranslations("growth.prospects.newSegment");
    const errorText = useErrorText();
    const { reloadSegments, setSegmentId } = useProspects();
    const [busy, setBusy] = useState(false);

    const submit = async (input: NewSegmentInput) => {
        setBusy(true);
        try {
            const { segment } = await prospectsApi.createSegment(input);
            await reloadSegments();
            setSegmentId(segment.id);
            toast.success(t("created", { name: segment.name }));
            onOpenChange(false);
        } catch (e) {
            toast.error(errorText(e, t("createFailed")));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>{t("description")}</DialogDescription>
                </DialogHeader>
                {open && (
                    <SegmentForm
                        idPrefix="seg"
                        submitLabel={t("create")}
                        busy={busy}
                        onSubmit={input => void submit(input)}
                        autoFocus
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
