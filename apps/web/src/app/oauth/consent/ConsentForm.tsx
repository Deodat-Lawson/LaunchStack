"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { FlowError } from "../_components/ConnectShell";
import { advanceOAuthFlow } from "../_components/flow";

export function ConsentForm({
    assistant,
    workspace,
    lines,
    email,
}: {
    assistant: string;
    workspace: string | null;
    lines: string[];
    email: string;
}) {
    const [pending, setPending] = useState<"allow" | "deny" | null>(null);
    const [error, setError] = useState<string | null>(null);

    const decide = async (accept: boolean) => {
        setError(null);
        setPending(accept ? "allow" : "deny");
        const failure = await advanceOAuthFlow("/oauth2/consent", { accept });
        if (failure) {
            setError(failure);
            setPending(null);
        }
    };

    if (!workspace) {
        return (
            <div className="border-line rounded-xl border p-5">
                <p className="text-ink-2 m-0 text-[13.5px] leading-[1.55]">
                    This connection has no workspace yet, or the choice expired. Start connecting
                    again from {assistant}.
                </p>
            </div>
        );
    }

    return (
        <div>
            <p className="text-ink-2 mb-3 mt-0 text-[13.5px] leading-[1.55]">
                {assistant} will act as <span className="text-ink font-medium">{email}</span> in{" "}
                <span className="text-ink font-medium">{workspace}</span>. It will be able to:
            </p>
            <ul className="border-line m-0 flex list-none flex-col gap-2.5 rounded-xl border p-4">
                {lines.map(line => (
                    <li
                        key={line}
                        className="text-ink flex items-start gap-2.5 text-[13.5px] leading-[1.5]"
                    >
                        <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
                        {line}
                    </li>
                ))}
            </ul>
            <p className="text-ink-3 mb-0 mt-3 text-[12.5px] leading-normal">
                It can never see more than you can. Disconnect it any time in Settings ›
                Integrations.
            </p>
            {error ? <FlowError>{error}</FlowError> : null}
            <div className="mt-5 flex flex-wrap gap-2.5">
                <Button type="button" onClick={() => void decide(true)} disabled={pending !== null}>
                    {pending === "allow" ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : null}
                    Allow
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => void decide(false)}
                    disabled={pending !== null}
                >
                    Deny
                </Button>
            </div>
        </div>
    );
}
