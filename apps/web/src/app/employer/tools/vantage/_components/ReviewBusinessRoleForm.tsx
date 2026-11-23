"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";
import styles from "./review-layout.module.css";
import { Textarea } from "~/components/ui/textarea";
import type {
    WeeklyReviewRoleDto,
    WeeklyReviewRoleInput,
} from "~/server/vantage/weekly-review-client-types";

type BusinessRoleContext = WeeklyReviewRoleDto["role"];
type BusinessRoleInput =
    Exclude<WeeklyReviewRoleInput, { role: null }> extends infer T
        ? Omit<T, "expectedVersion">
        : never;

const lines = (text: string) =>
    text
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

export function ReviewBusinessRoleForm({
    role,
    disabled,
    onSave,
}: {
    role: BusinessRoleContext | null;
    disabled: boolean;
    onSave: (role: BusinessRoleInput | null) => Promise<void>;
}) {
    const t = useTranslations("vantage.weeklyReview");
    const [primaryRole, setPrimaryRole] = useState(role?.primaryRole ?? "");
    const [responsibilities, setResponsibilities] = useState(
        role?.responsibilities.join("\n") ?? ""
    );
    const [priorities, setPriorities] = useState(role?.priorities.join("\n") ?? "");
    const [clearOpen, setClearOpen] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const responsibilityLines = lines(responsibilities);
    const priorityLines = lines(priorities);
    const valid =
        primaryRole.trim().length > 0 &&
        primaryRole.trim().length <= 80 &&
        responsibilityLines.length <= 8 &&
        priorityLines.length <= 8 &&
        [...responsibilityLines, ...priorityLines].every(line => line.length <= 160);
    const dirty =
        primaryRole.trim() !== (role?.primaryRole ?? "") ||
        JSON.stringify(responsibilityLines) !== JSON.stringify(role?.responsibilities ?? []) ||
        JSON.stringify(priorityLines) !== JSON.stringify(role?.priorities ?? []);
    return (
        <div className="space-y-5">
            <p className={cn(styles.label, styles.prose)}>{t("businessRoleHelp")}</p>
            <div className="space-y-2">
                <Label htmlFor="weekly-review-business-role" className={styles.label}>
                    {t("primaryBusinessRole")}
                </Label>
                <Input
                    id="weekly-review-business-role"
                    value={primaryRole}
                    maxLength={80}
                    disabled={disabled}
                    className={styles.body}
                    onChange={event => {
                        setPrimaryRole(event.target.value);
                        setConfirmed(false);
                    }}
                />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="weekly-review-responsibilities" className={styles.label}>
                        {t("businessResponsibilities")}
                    </Label>
                    <Textarea
                        id="weekly-review-responsibilities"
                        value={responsibilities}
                        disabled={disabled}
                        className={cn(styles.body, "min-h-28")}
                        aria-describedby="weekly-review-role-limits"
                        onChange={event => {
                            setResponsibilities(event.target.value);
                            setConfirmed(false);
                        }}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="weekly-review-priorities" className={styles.label}>
                        {t("businessPriorities")}
                    </Label>
                    <Textarea
                        id="weekly-review-priorities"
                        value={priorities}
                        disabled={disabled}
                        className={cn(styles.body, "min-h-28")}
                        aria-describedby="weekly-review-role-limits"
                        onChange={event => {
                            setPriorities(event.target.value);
                            setConfirmed(false);
                        }}
                    />
                </div>
                <p id="weekly-review-role-limits" className={cn(styles.label, "sm:col-span-2")}>
                    {t("businessRoleLimits")}
                </p>
            </div>
            <Label className={cn(styles.label, "flex items-start gap-3 leading-relaxed")}>
                <Checkbox
                    checked={confirmed}
                    disabled={disabled}
                    onCheckedChange={checked => setConfirmed(checked === true)}
                />
                {t("confirmBusinessRole")}
            </Label>
            <div className="flex flex-wrap gap-2">
                <Button
                    disabled={disabled || !confirmed || !valid || !dirty}
                    onClick={() =>
                        void onSave({
                            primaryRole: primaryRole.trim(),
                            responsibilities: responsibilityLines,
                            priorities: priorityLines,
                            confirmed: true,
                        })
                    }
                >
                    {t("saveBusinessRole")}
                </Button>
                <Button
                    variant="outline"
                    disabled={disabled || !role}
                    onClick={() => setClearOpen(true)}
                >
                    {t("clearBusinessRole")}
                </Button>
            </div>
            <ConfirmDialog
                open={clearOpen}
                onOpenChange={setClearOpen}
                title={t("clearRoleTitle")}
                description={t("clearRoleDescription")}
                confirmLabel={t("clearBusinessRole")}
                destructive
                onConfirm={() => {
                    if (!disabled) void onSave(null);
                }}
            />
        </div>
    );
}
