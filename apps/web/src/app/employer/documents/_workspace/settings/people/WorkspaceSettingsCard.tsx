"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { isJoinPolicy, type JoinPolicy } from "~/lib/authz/permissions";

import { errorMessage, peopleApi, type WorkspaceSettings } from "./api";
import { ErrorNote, Panel } from "./ui";

const FOREVER = "forever";

const RETENTION_OPTIONS: { value: string; label: string }[] = [
    { value: FOREVER, label: "Keep forever" },
    { value: "30", label: "30 days" },
    { value: "90", label: "90 days" },
    { value: "180", label: "180 days" },
    { value: "365", label: "One year" },
];

function retentionToValue(days: number | null): string {
    if (days === null) return FOREVER;
    const known = RETENTION_OPTIONS.find(o => o.value === String(days));
    return known ? known.value : String(days);
}

/** Join policy and audit retention. Shown only to people with `settings.manage`. */
export function WorkspaceSettingsCard() {
    const [saved, setSaved] = useState<WorkspaceSettings | null>(null);
    const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>("approval");
    const [retention, setRetention] = useState<string>(FOREVER);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await peopleApi.settings.get();
                if (cancelled) return;
                setSaved(res);
                setJoinPolicy(res.joinPolicy);
                setRetention(retentionToValue(res.auditRetentionDays));
            } catch (err) {
                if (!cancelled) setError(errorMessage(err, "Could not load workspace settings."));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const retentionDays = retention === FOREVER ? null : Number(retention);
    const dirty =
        saved !== null &&
        (joinPolicy !== saved.joinPolicy || retentionDays !== saved.auditRetentionDays);

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await peopleApi.settings.update({
                joinPolicy,
                auditRetentionDays: retentionDays,
            });
            setSaved(res);
            setJoinPolicy(res.joinPolicy);
            setRetention(retentionToValue(res.auditRetentionDays));
            toast.success("Workspace settings saved");
        } catch (err) {
            setError(errorMessage(err, "The settings weren't saved."));
        } finally {
            setSaving(false);
        }
    };

    // Options the server may return that aren't in the preset list still render.
    const retentionOptions =
        retention !== FOREVER && !RETENTION_OPTIONS.some(o => o.value === retention)
            ? [...RETENTION_OPTIONS, { value: retention, label: `${retention} days` }]
            : RETENTION_OPTIONS;

    return (
        <Panel className="p-5">
            <div className="mb-4">
                <h2 className="text-ink m-0 text-base font-bold tracking-[-0.01em]">
                    Workspace settings
                </h2>
                <p className="text-ink-3 m-0 mt-1 text-[13px] leading-normal">
                    How people get in, and how long the audit log is kept.
                </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <fieldset className="m-0 border-0 p-0" disabled={loading || saving}>
                    <legend className="text-ink-2 mb-2 text-xs font-semibold">
                        When someone uses a join link
                    </legend>
                    <RadioGroup
                        value={joinPolicy}
                        onValueChange={value => {
                            if (isJoinPolicy(value)) setJoinPolicy(value);
                        }}
                        aria-label="Join policy"
                    >
                        <label
                            htmlFor="join-approval"
                            className="border-line hover:bg-panel-2 flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5"
                        >
                            <RadioGroupItem
                                id="join-approval"
                                value="approval"
                                className="mt-0.5"
                            />
                            <span>
                                <span className="text-ink block text-[13px] font-semibold">
                                    Approval required
                                </span>
                                <span className="text-ink-3 block text-[12.5px] leading-normal">
                                    They wait on the pending list until an admin approves them.
                                </span>
                            </span>
                        </label>
                        <label
                            htmlFor="join-open"
                            className="border-line hover:bg-panel-2 flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5"
                        >
                            <RadioGroupItem id="join-open" value="open" className="mt-0.5" />
                            <span>
                                <span className="text-ink block text-[13px] font-semibold">
                                    Anyone with a link joins immediately
                                </span>
                                <span className="text-ink-3 block text-[12.5px] leading-normal">
                                    They get the link&apos;s role the moment they use it. Revoke
                                    links you no longer trust.
                                </span>
                            </span>
                        </label>
                    </RadioGroup>
                </fieldset>

                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="audit-retention">Keep audit events for</Label>
                    <Select
                        value={retention}
                        onValueChange={setRetention}
                        disabled={loading || saving}
                    >
                        <SelectTrigger id="audit-retention" className="w-full md:w-[220px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {retentionOptions.map(o => (
                                <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-ink-3 m-0 text-[11.5px] leading-normal">
                        Older events are deleted. Export a CSV first if you need a permanent copy.
                    </p>
                </div>
            </div>

            {error && (
                <div className="mt-4">
                    <ErrorNote message={error} />
                </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
                {dirty && (
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => {
                            if (!saved) return;
                            setJoinPolicy(saved.joinPolicy);
                            setRetention(retentionToValue(saved.auditRetentionDays));
                        }}
                    >
                        Discard
                    </Button>
                )}
                <Button
                    size="sm"
                    disabled={!dirty || saving || loading}
                    onClick={() => void save()}
                >
                    {saving ? "Saving…" : "Save settings"}
                </Button>
            </div>
        </Panel>
    );
}
