"use client";

import { cn } from "~/lib/utils";

import { InlineError } from "../../_components/EmptyState";
import { PageHeader } from "../../_components/PageHeader";
import { SkeletonRows } from "../../_components/SkeletonRows";
import { useResource } from "../../_lib/useResource";
import { NetworkMark } from "../_components/NetworkMark";
import { brandApi } from "../api";

/**
 * Where posts go and whether they can. Connections are the deployment's
 * today; the page says so plainly and lists what connecting takes, so an
 * operator can act on it without a hunt through the environment.
 */
export function AccountsScreen() {
    const res = useResource("brand:accounts", () => brandApi.accounts());
    const accounts = res.data?.accounts ?? [];
    const connected = accounts.filter(a => a.configured).length;
    return (
        <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
            <PageHeader
                size="md"
                title="Accounts"
                sub={
                    res.data
                        ? `${connected} of ${accounts.length} networks connected. Connections are set for the whole deployment today; per-workspace sign-in comes next.`
                        : undefined
                }
            />
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
            {res.loading ? (
                <SkeletonRows rows={4} height={72} />
            ) : (
                <div className="border-line bg-panel rounded-lg border">
                    {accounts.map(a => (
                        <div
                            key={a.platform}
                            className="border-line-2 grid gap-3 border-t px-4 py-4 first:border-t-0 md:grid-cols-[200px_minmax(0,1fr)]"
                        >
                            <div className="flex items-start gap-3">
                                <NetworkMark
                                    platform={a.platform}
                                    size={28}
                                    muted={!a.configured}
                                />
                                <div className="min-w-0">
                                    <div className="text-ink text-[14px] font-medium">
                                        {a.label}
                                    </div>
                                    <div
                                        className={cn(
                                            "mt-0.5 inline-flex items-center gap-1.5 text-xs",
                                            a.configured ? "text-ink-2" : "text-ink-3"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "size-[7px] rounded-full",
                                                a.configured ? "bg-success" : "border-line border"
                                            )}
                                        />
                                        {a.configured ? "Connected" : "Not connected"}
                                    </div>
                                    {a.identity && (
                                        <div className="text-ink-3 mt-0.5 truncate font-mono text-[11.5px]">
                                            {a.identity}
                                        </div>
                                    )}
                                    <div className="text-ink-3 mt-1 font-mono text-[11.5px] tabular-nums">
                                        {a.limit === null
                                            ? "no hard limit"
                                            : `${a.limit.toLocaleString()} characters`}
                                    </div>
                                </div>
                            </div>
                            <div className="text-[13px]">
                                <p className="text-ink-2">{a.note}</p>
                                <div className="text-ink-3 mt-2 text-xs">
                                    {a.configured ? "Connected with" : "To connect"}
                                </div>
                                <ol className="text-ink-2 mt-1 list-decimal space-y-0.5 pl-5">
                                    {a.requires.map(step => (
                                        <li key={step}>{step}</li>
                                    ))}
                                </ol>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <p className="text-ink-3 max-w-[70ch] text-[13px]">
                Sign-in per workspace is the next step for Brand: each workspace connects its own
                LinkedIn page, Bluesky account and Reddit app, and X on pay-per-use. Instagram and
                Threads follow once the Meta app review is through.
            </p>
        </div>
    );
}
