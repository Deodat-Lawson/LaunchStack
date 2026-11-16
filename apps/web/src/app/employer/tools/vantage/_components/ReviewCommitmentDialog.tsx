"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { useOptionalToolNav } from "~/components/tool-app/nav";
import { toolTabHref } from "~/lib/tool-app/locations";
import { vantageApi, type WeeklyReviewDto } from "../api";
import { useWeeklyReviewErrorText } from "../_lib/weekly-review-errors";

type Topic = WeeklyReviewDto["report"]["topics"][number];
export function ReviewCommitmentDialog({
    topic,
    onClose,
    onAdded,
}: {
    topic: Topic;
    onClose: () => void;
    onAdded: () => void;
}) {
    const t = useTranslations("vantage.weeklyReview");
    const nav = useOptionalToolNav();
    const errorText = useWeeklyReviewErrorText();
    const [title, setTitle] = useState(topic.proposedNextStep);
    const [owner, setOwner] = useState(topic.proposedOwner ?? "");
    const [due, setDue] = useState(topic.proposedDue ?? "");
    const [test, setTest] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const submitting = useRef(false);
    async function submit() {
        if (submitting.current || !title.trim() || !owner.trim() || !due) return;
        submitting.current = true;
        setBusy(true);
        setError("");
        try {
            await vantageApi.addCommitment({
                title: title.trim(),
                owner: owner.trim(),
                dueOn: due,
                test: test.trim() || null,
            });
            onAdded();
            // The toast is rendered outside the tool provider. Capture navigation
            // here instead of mounting a context-dependent ToolLink in the toaster.
            const link = (
                <a
                    href={
                        nav ? nav.linkFor("/commitments") : toolTabHref("vantage", "/commitments")
                    }
                    onClick={event => {
                        if (
                            nav &&
                            event.button === 0 &&
                            !event.metaKey &&
                            !event.ctrlKey &&
                            !event.shiftKey &&
                            !event.altKey
                        ) {
                            event.preventDefault();
                            nav.navigate("/commitments");
                        }
                    }}
                    className="text-brand underline"
                >
                    {t("founder.commitmentLink")}
                </a>
            );
            toast.success(t("founder.added"), { description: link });
            onClose();
        } catch (reason) {
            setError(errorText(reason));
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    }
    return (
        <Dialog
            open
            onOpenChange={open => {
                if (!open && !busy) onClose();
            }}
        >
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t("founder.addCommitment")}</DialogTitle>
                    <DialogDescription>{t("founder.commitmentDescription")}</DialogDescription>
                </DialogHeader>
                <form
                    onSubmit={event => {
                        event.preventDefault();
                        void submit();
                    }}
                    className="space-y-4"
                >
                    <div className="space-y-1">
                        <Label htmlFor="review-commitment-title">
                            {t("founder.commitmentTitle")}
                        </Label>
                        <Input
                            id="review-commitment-title"
                            value={title}
                            onChange={event => setTitle(event.target.value)}
                            required
                            disabled={busy}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="review-commitment-owner">
                            {t("founder.commitmentOwner")}
                        </Label>
                        <Input
                            id="review-commitment-owner"
                            value={owner}
                            onChange={event => setOwner(event.target.value)}
                            required
                            disabled={busy}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="review-commitment-due">{t("founder.commitmentDue")}</Label>
                        <Input
                            id="review-commitment-due"
                            type="date"
                            value={due}
                            onChange={event => setDue(event.target.value)}
                            required
                            disabled={busy}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="review-commitment-test">
                            {t("founder.commitmentTest")}
                        </Label>
                        <Textarea
                            id="review-commitment-test"
                            value={test}
                            onChange={event => setTest(event.target.value)}
                            disabled={busy}
                        />
                    </div>
                    {error ? (
                        <p role="alert" className="text-danger text-sm">
                            {error}
                        </p>
                    ) : null}
                    <DialogFooter>
                        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                            {t("founder.cancel")}
                        </Button>
                        <Button
                            type="submit"
                            disabled={busy || !title.trim() || !owner.trim() || !due}
                        >
                            {t("founder.confirmCommitment")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
