"use client";

import { BellOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";

import { CONTRACTS } from "./data";

/**
 * A tool's own settings: how this tool behaves for the workspace. (A
 * person's preferences belong in Settings; workspace-wide policy in the
 * Workspace tab. A tool keeps only what is about itself.)
 *
 * - Rows, not cards: what the setting is and what it does on the left, the
 *   control on the right; the rows fold to one column in a narrow tab.
 * - A setting applies when it changes — no Save button for toggles and
 *   pickers. A notice (`Alert`) says what an "off" means for people.
 * - The destructive action is last, set apart, and asks first.
 */
export function SettingsScreen() {
    const t = useTranslations("designTemplate.settings");
    const [reminders, setReminders] = useState(true);
    const [lead, setLead] = useState("30");
    const [digest, setDigest] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const ids = { reminders: useId(), lead: useId(), digest: useId() };

    return (
        <div className="mx-auto flex max-w-[1080px] flex-col gap-7">
            <PageHeader size="md" title={t("title")} />
            <div className="flex max-w-[760px] flex-col gap-7">
                <section className="flex flex-col gap-3">
                    <SectionHeading title={t("reminders")} />
                    {!reminders && (
                        <Alert variant="warn">
                            <BellOff />
                            <AlertDescription>{t("offNotice")}</AlertDescription>
                        </Alert>
                    )}
                    <div className="border-line bg-panel rounded-lg border">
                        <SettingRow
                            label={t("remindersRow")}
                            body={t("remindersBody")}
                            htmlFor={ids.reminders}
                        >
                            <Switch
                                id={ids.reminders}
                                checked={reminders}
                                onCheckedChange={setReminders}
                            />
                        </SettingRow>
                        <SettingRow label={t("lead")} body={t("leadBody")} htmlFor={ids.lead}>
                            <Select value={lead} onValueChange={setLead} disabled={!reminders}>
                                <SelectTrigger id={ids.lead} size="sm" className="w-32">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {[14, 30, 60].map(days => (
                                        <SelectItem key={days} value={String(days)}>
                                            {t("leadDays", { days })}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </SettingRow>
                        <SettingRow label={t("digest")} body={t("digestBody")} htmlFor={ids.digest}>
                            <Switch
                                id={ids.digest}
                                checked={digest}
                                onCheckedChange={setDigest}
                                disabled={!reminders}
                            />
                        </SettingRow>
                    </div>
                </section>

                <section>
                    <div className="border-danger/30 rounded-lg border">
                        <SettingRow label={t("danger")} body={t("dangerBody")}>
                            <Button
                                size="sm"
                                variant="outline"
                                className="text-danger-ink"
                                onClick={() => setConfirming(true)}
                            >
                                {t("dangerAction")}
                            </Button>
                        </SettingRow>
                    </div>
                </section>
            </div>

            <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={t("dangerTitle")}
                description={t("dangerConfirmBody", { count: CONTRACTS.length })}
                confirmLabel={t("dangerAction")}
                onConfirm={() => {
                    setConfirming(false);
                    toast.success(t("allDeleted"));
                }}
            />
        </div>
    );
}

function SettingRow({
    label,
    body,
    htmlFor,
    children,
}: {
    label: string;
    body: string;
    htmlFor?: string;
    children: ReactNode;
}) {
    return (
        <div className="border-line-2 @max-sm:grid-cols-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 border-t px-4 py-3.5 first:border-t-0">
            <div className="min-w-0">
                <label htmlFor={htmlFor} className="text-ink block text-sm font-medium">
                    {label}
                </label>
                <p className="text-ink-3 mt-0.5 text-[13px] leading-normal">{body}</p>
            </div>
            <div className="flex items-center">{children}</div>
        </div>
    );
}
