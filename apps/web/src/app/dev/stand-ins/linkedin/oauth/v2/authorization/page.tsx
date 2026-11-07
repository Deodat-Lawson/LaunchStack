import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ShieldCheck, TriangleAlert } from "lucide-react";

import { devRoutesEnabled } from "~/app/dev/enabled";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";

import { Monogram, StandInBanner } from "../../../../shared/ui";
import {
    DANA,
    LINKEDIN_BASE_PATH,
    assetPath,
    checkAuthorizationRequest,
    personUrn,
} from "../../../world";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { absolute: "LinkedIn stand-in" } };

const SCOPE_TEXT: Record<string, string> = {
    openid: "Confirm who you are",
    profile: "See your name and photo",
    email: "See your primary email address",
    r_basicprofile: "See your basic profile",
    r_liteprofile: "See your name and photo",
    r_emailaddress: "See your primary email address",
    w_member_social: "Post, comment and react as you",
    w_member_social_feed: "Comment and react as you",
    r_member_social: "Read your posts and their comments",
    rw_organization_admin: "Manage your Pages and read their analytics",
    r_organization_admin: "Read your Pages and their analytics",
    w_organization_social: "Post, comment and react as your Pages",
    w_organization_social_feed: "Comment and react as your Pages",
    r_organization_social: "Read your Pages' posts and comments",
    r_organization_social_feed: "Read comments on your Pages' posts",
    r_organization_followers: "See who follows your Pages",
};

/**
 * GET …/oauth/v2/authorization — the stand-in's consent screen. Dana Okafor
 * is always signed in; Allow and Cancel post to …/oauth/v2/consent, which
 * sends the browser back to the app's redirect_uri the way LinkedIn does.
 */
export default async function AuthorizationPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    if (!devRoutesEnabled()) notFound();
    const raw = await searchParams;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === "string") params.set(key, value);
        else if (Array.isArray(value) && value[0] !== undefined) params.set(key, value[0]);
    }
    const check = checkAuthorizationRequest(params);
    if (!check.ok && check.kind === "redirect") redirect(check.location);

    return (
        <div className="bg-surface text-ink min-h-dvh">
            <StandInBanner network="LinkedIn" />
            <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-12">
                <p className="text-ink-3 text-center text-sm font-semibold tracking-wide">
                    LinkedIn stand-in
                </p>
                {check.ok ? (
                    <Card className="gap-5 p-6">
                        <div className="flex flex-col gap-1">
                            <h1 className="display text-lg font-semibold">
                                Allow this app to use your account?
                            </h1>
                            <p className="text-ink-3 text-sm">
                                App <span className="text-ink-2 font-mono">{check.clientId}</span>{" "}
                                is asking for access.
                            </p>
                        </div>

                        <div className="bg-panel-2 flex items-center gap-3 rounded-lg p-3">
                            <Monogram
                                src={assetPath(`member-${DANA.id}`)}
                                name={`${DANA.firstName} ${DANA.lastName}`}
                                className="size-9"
                            />
                            <div className="min-w-0">
                                <p className="text-sm font-medium">
                                    Signed in as {DANA.firstName} {DANA.lastName}
                                </p>
                                <p className="text-ink-3 truncate font-mono text-[11px]">
                                    {personUrn(DANA.id)}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <p className="text-ink-2 text-sm font-medium">It will be able to:</p>
                            <ul className="flex flex-col gap-2">
                                {check.scopes.map(scope => (
                                    <li key={scope} className="flex items-start gap-2 text-sm">
                                        <ShieldCheck
                                            className="text-success-ink mt-0.5 size-4 shrink-0"
                                            aria-hidden
                                        />
                                        <span>
                                            {SCOPE_TEXT[scope] ?? scope}{" "}
                                            <span className="text-ink-3 font-mono text-[11px]">
                                                {scope}
                                            </span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <p className="text-ink-3 break-all text-xs">
                            You will be sent back to{" "}
                            <span className="text-ink-2 font-mono">{check.redirectUri}</span>
                        </p>

                        <form
                            method="post"
                            action={`${LINKEDIN_BASE_PATH}/oauth/v2/consent`}
                            className="flex justify-end gap-2"
                        >
                            <input type="hidden" name="client_id" value={check.clientId} />
                            <input type="hidden" name="redirect_uri" value={check.redirectUri} />
                            <input type="hidden" name="scope" value={check.scopes.join(" ")} />
                            {check.state !== null ? (
                                <input type="hidden" name="state" value={check.state} />
                            ) : null}
                            <Button type="submit" name="decision" value="cancel" variant="outline">
                                Cancel
                            </Button>
                            <Button type="submit" name="decision" value="allow">
                                Allow
                            </Button>
                        </form>
                    </Card>
                ) : (
                    <Card className="gap-3 p-6">
                        <h1 className="display flex items-center gap-2 text-lg font-semibold">
                            <TriangleAlert className="text-danger size-5" aria-hidden />
                            This sign-in link is not valid
                        </h1>
                        <p className="text-ink-2 text-sm">{check.message}</p>
                        <p className="text-ink-3 text-xs">
                            LinkedIn shows a page like this instead of returning to the app when it
                            cannot trust where to send you back.
                        </p>
                    </Card>
                )}
            </main>
        </div>
    );
}
