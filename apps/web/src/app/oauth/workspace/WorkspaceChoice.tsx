"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { isBuiltinRole, normalizeRoleSlug } from "~/lib/authz/permissions";
import type { WorkspaceOption } from "~/server/mcp/connect-request";
import { FlowError } from "../_components/ConnectShell";
import { advanceOAuthFlow } from "../_components/flow";

export function WorkspaceChoice({
    assistant,
    workspaces,
}: {
    assistant: string;
    workspaces: WorkspaceOption[];
}) {
    const t = useTranslations("auth.oauth.workspace");
    const tFlow = useTranslations("auth.oauth.flow");
    const tRoles = useTranslations("auth.roles");
    const tc = useTranslations("common.actions");
    const roleName = (role: string) => {
        const slug = normalizeRoleSlug(role);
        return isBuiltinRole(slug) ? tRoles(slug) : role;
    };
    const [choice, setChoice] = useState(workspaces[0]?.id ?? "");
    const [pending, setPending] = useState<"continue" | "cancel" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const groupId = useId();

    if (workspaces.length === 0) {
        return (
            <div className="border-line flex flex-col gap-3 rounded-xl border p-5">
                <p className="text-ink-2 m-0 text-[13.5px] leading-[1.55]">
                    {t("none", { assistant })}
                </p>
                <Button asChild variant="outline" className="self-start">
                    <Link href="/workspaces">{t("goToWorkspaces")}</Link>
                </Button>
            </div>
        );
    }

    const onContinue = async () => {
        setError(null);
        setPending("continue");
        const saved = await fetch("/api/oauth/workspace-choice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId: choice, oauthQuery: window.location.search }),
        }).catch(() => null);
        if (!saved?.ok) {
            const body = (await saved?.json().catch(() => null)) as { error?: string } | null;
            setError(body?.error ?? t("saveFailed"));
            setPending(null);
            return;
        }
        const failure = await advanceOAuthFlow("/oauth2/continue", { postLogin: true }, tFlow);
        if (failure) {
            setError(failure);
            setPending(null);
        }
    };

    const onCancel = async () => {
        setError(null);
        setPending("cancel");
        const failure = await advanceOAuthFlow("/oauth2/consent", { accept: false }, tFlow);
        if (failure) {
            setError(failure);
            setPending(null);
        }
    };

    return (
        <div>
            <p
                id={`${groupId}-label`}
                className="text-ink-2 mb-3 mt-0 text-[13.5px] leading-[1.55]"
            >
                {t("question", { assistant })}
            </p>
            <RadioGroup
                aria-labelledby={`${groupId}-label`}
                value={choice}
                onValueChange={setChoice}
                className="gap-2"
            >
                {workspaces.map(w => (
                    <Label
                        key={w.id}
                        htmlFor={`${groupId}-${w.id}`}
                        className="border-line hover:bg-panel has-[[data-state=checked]]:border-brand has-[[data-state=checked]]:bg-brand-soft flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 font-normal"
                    >
                        <RadioGroupItem id={`${groupId}-${w.id}`} value={w.id} />
                        <span className="text-ink min-w-0 flex-1 truncate text-sm font-medium">
                            {w.name}
                        </span>
                        <span className="text-ink-3 shrink-0 text-[12px] capitalize">
                            {roleName(w.role)}
                        </span>
                    </Label>
                ))}
            </RadioGroup>
            {error ? <FlowError>{error}</FlowError> : null}
            <div className="mt-5 flex flex-wrap gap-2.5">
                <Button
                    type="button"
                    onClick={() => void onContinue()}
                    disabled={!choice || pending !== null}
                >
                    {pending === "continue" ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : null}
                    {tc("continue")}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => void onCancel()}
                    disabled={pending !== null}
                >
                    {tc("cancel")}
                </Button>
            </div>
        </div>
    );
}
