import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck, TriangleAlert } from "lucide-react";

import { devRoutesEnabled } from "~/app/dev/enabled";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";

import { StandInBanner } from "../../../../../shared/ui";
import { acceptableRedirect } from "../../../../dispatch";
import { ACCOUNT, GOOGLE_BASE_PATH } from "../../../../world";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { absolute: "Google stand-in" } };

const SCOPE_TEXT: Record<string, string> = {
    openid: "Associate you with your personal info on Google",
    email: "See your primary Google Account email address",
    "https://www.googleapis.com/auth/drive.file":
        "See, edit, create, and delete only the specific Google Drive files you use with this app",
    "https://www.googleapis.com/auth/drive.readonly":
        "See and download all your Google Drive files",
    "https://www.googleapis.com/auth/gmail.readonly": "View your email messages and settings",
};

/** Identity is always granted; everything else gets a box, as Google's granular consent does. */
const ALWAYS = new Set(["openid", "email", "profile"]);

/**
 * GET …/o/oauth2/v2/auth — the stand-in's consent screen. Alex Rivera is
 * always signed in. Each Drive scope can be unticked, the way Google lets
 * people decline one permission and keep the rest; Allow and Cancel post to
 * …/consent, which sends the browser back to the app's redirect_uri.
 */
export default async function GoogleConsentPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    if (!devRoutesEnabled()) notFound();
    const raw = await searchParams;
    const one = (key: string) => {
        const value = raw[key];
        return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? null) : null;
    };
    const clientId = one("client_id");
    const redirectUri = one("redirect_uri");
    const state = one("state");
    const scopes = (one("scope") ?? "").split(/\s+/).filter(Boolean);
    const problem = !clientId
        ? "The request has no client_id."
        : !acceptableRedirect(redirectUri)
          ? "The redirect_uri is missing or does not point at this machine."
          : scopes.length === 0
            ? "The request asks for no scopes."
            : null;

    return (
        <div className="bg-surface text-ink min-h-dvh">
            <StandInBanner network="Google" />
            <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-12">
                <p className="text-ink-3 text-center text-sm font-semibold tracking-wide">
                    Google stand-in
                </p>
                {problem ? (
                    <Card className="gap-3 p-6">
                        <h1 className="display flex items-center gap-2 text-lg font-semibold">
                            <TriangleAlert className="text-danger size-5" aria-hidden />
                            Access blocked: this request is invalid
                        </h1>
                        <p className="text-ink-2 text-sm">{problem}</p>
                    </Card>
                ) : (
                    <Card className="gap-5 p-6">
                        <div className="flex flex-col gap-1">
                            <h1 className="display text-lg font-semibold">
                                LaunchStack wants access to your Google Account
                            </h1>
                            <p className="text-ink-3 text-sm">{ACCOUNT.email}</p>
                        </div>
                        <form
                            method="post"
                            action={`${GOOGLE_BASE_PATH}/consent`}
                            className="flex flex-col gap-4"
                        >
                            <input type="hidden" name="client_id" value={clientId!} />
                            <input type="hidden" name="redirect_uri" value={redirectUri!} />
                            {state !== null ? (
                                <input type="hidden" name="state" value={state} />
                            ) : null}
                            <ul className="flex flex-col gap-3">
                                {scopes.map(scope =>
                                    ALWAYS.has(scope) ? (
                                        <li key={scope} className="flex items-start gap-2 text-sm">
                                            <ShieldCheck
                                                className="text-success mt-0.5 size-4 shrink-0"
                                                aria-hidden
                                            />
                                            <span>{SCOPE_TEXT[scope] ?? scope}</span>
                                        </li>
                                    ) : (
                                        <li key={scope}>
                                            <label className="flex items-start gap-2 text-sm">
                                                <input
                                                    type="checkbox"
                                                    name="scope"
                                                    value={scope}
                                                    defaultChecked
                                                    className="mt-1"
                                                />
                                                <span>
                                                    {SCOPE_TEXT[scope] ?? scope}
                                                    <span className="text-ink-3 block break-all font-mono text-[11px]">
                                                        {scope}
                                                    </span>
                                                </span>
                                            </label>
                                        </li>
                                    )
                                )}
                            </ul>
                            <p className="text-ink-3 break-all text-xs">
                                You will be sent back to{" "}
                                <span className="text-ink-2 font-mono">{redirectUri}</span>
                            </p>
                            <div className="flex justify-end gap-2">
                                <Button
                                    type="submit"
                                    name="decision"
                                    value="cancel"
                                    variant="outline"
                                >
                                    Cancel
                                </Button>
                                <Button type="submit" name="decision" value="allow">
                                    Allow
                                </Button>
                            </div>
                        </form>
                    </Card>
                )}
            </main>
        </div>
    );
}
