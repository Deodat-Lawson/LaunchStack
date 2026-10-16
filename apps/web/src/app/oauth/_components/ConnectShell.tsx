"use client";

/**
 * Frame for the two screens an assistant's OAuth connection passes through
 * after sign-in: pick a workspace (/oauth/workspace), then allow access
 * (/oauth/consent). Same chrome as /signin, one narrow column, and a header
 * that says who is asking and where the browser goes back to.
 */
import { BadgeCheck, ShieldAlert } from "lucide-react";

import { AuthChrome } from "~/app/_components/AuthChrome";
import type { ConnectingClient } from "~/server/mcp/connect-request";

export function ConnectShell({
    client,
    step,
    children,
}: {
    client: ConnectingClient | null;
    step: string;
    children: React.ReactNode;
}) {
    const name = client?.name ?? "An assistant";
    return (
        <div className="bg-surface text-ink flex min-h-screen flex-col">
            <AuthChrome />
            <main className="flex flex-1 justify-center px-4 py-10 sm:px-6 sm:py-14">
                <div className="w-full max-w-[460px]">
                    <div className="text-ink-3 mb-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                        {step}
                    </div>
                    <h1 className="display text-ink mb-5 text-[28px] leading-[1.15] tracking-[-0.02em]">
                        Connect {name} to LaunchStack
                    </h1>
                    {client ? <ClientIdentity client={client} /> : null}
                    {children}
                </div>
            </main>
        </div>
    );
}

function ClientIdentity({ client }: { client: ConnectingClient }) {
    const initial = client.name.trim().charAt(0).toUpperCase() || "?";
    return (
        <div className="border-line bg-panel mb-6 flex items-start gap-3 rounded-xl border p-4">
            {client.icon ? (
                // A client-supplied logo URL; next/image would need its host allow-listed.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={client.icon}
                    alt=""
                    className="border-line size-9 shrink-0 rounded-lg border object-contain"
                />
            ) : (
                <div className="bg-brand-soft text-brand flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold">
                    {initial}
                </div>
            )}
            <div className="min-w-0 flex-1">
                <div className="text-ink truncate text-sm font-semibold">{client.name}</div>
                {client.redirectHost ? (
                    <div className="text-ink-3 mt-0.5 text-[12.5px] leading-normal">
                        Sends you back to{" "}
                        <span className="text-ink-2 font-mono text-[12px]">
                            {client.redirectHost}
                        </span>
                    </div>
                ) : null}
                {client.verifiedDomain ? (
                    <div className="text-success mt-1.5 flex items-center gap-1.5 text-[12px]">
                        <BadgeCheck className="size-3.5" aria-hidden />
                        Identity published at {client.verifiedDomain}
                    </div>
                ) : (
                    <div className="text-ink-3 mt-1.5 flex items-start gap-1.5 text-[12px] leading-normal">
                        <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                        This assistant named itself. Continue only if you just started connecting
                        it.
                    </div>
                )}
            </div>
        </div>
    );
}

export function FlowError({ children }: { children: React.ReactNode }) {
    return (
        <p role="alert" className="text-danger m-0 mt-3 text-[12.5px] leading-normal">
            {children}
        </p>
    );
}
