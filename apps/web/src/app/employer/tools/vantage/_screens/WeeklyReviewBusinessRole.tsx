"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import type {
    BusinessRoleContext,
    BusinessRoleInput,
} from "~/server/vantage/weekly-review-business-role";

const lines = (text: string) =>
    text
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

export function WeeklyReviewBusinessRole({
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
    const [confirmed, setConfirmed] = useState(false);
    const responsibilityLines = lines(responsibilities);
    const priorityLines = lines(priorities);
    const valid =
        primaryRole.trim().length > 0 &&
        primaryRole.trim().length <= 80 &&
        responsibilityLines.length <= 8 &&
        priorityLines.length <= 8 &&
        [...responsibilityLines, ...priorityLines].every(line => line.length <= 160);
    return (
        <details className="border-line space-y-3 rounded border p-4">
            <summary>{t("businessRole")}</summary>
            <p className="text-ink-2 text-sm">{t("businessRoleHelp")}</p>
            <Label htmlFor="weekly-review-business-role">{t("primaryBusinessRole")}</Label>
            <Input
                id="weekly-review-business-role"
                value={primaryRole}
                maxLength={80}
                disabled={disabled}
                onChange={event => {
                    setPrimaryRole(event.target.value);
                    setConfirmed(false);
                }}
            />
            <Label htmlFor="weekly-review-responsibilities">{t("businessResponsibilities")}</Label>
            <Textarea
                id="weekly-review-responsibilities"
                value={responsibilities}
                disabled={disabled}
                onChange={event => {
                    setResponsibilities(event.target.value);
                    setConfirmed(false);
                }}
            />
            <Label htmlFor="weekly-review-priorities">{t("businessPriorities")}</Label>
            <Textarea
                id="weekly-review-priorities"
                value={priorities}
                disabled={disabled}
                onChange={event => {
                    setPriorities(event.target.value);
                    setConfirmed(false);
                }}
            />
            <p className="text-ink-2 text-sm">{t("businessRoleLimits")}</p>
            <Label className="flex items-center gap-2">
                <Checkbox
                    checked={confirmed}
                    disabled={disabled}
                    onCheckedChange={checked => setConfirmed(checked === true)}
                />
                {t("confirmBusinessRole")}
            </Label>
            <div className="flex gap-2">
                <Button
                    disabled={disabled || !confirmed || !valid}
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
                <Button disabled={disabled || !role} onClick={() => void onSave(null)}>
                    {t("clearBusinessRole")}
                </Button>
            </div>
        </details>
    );
}
