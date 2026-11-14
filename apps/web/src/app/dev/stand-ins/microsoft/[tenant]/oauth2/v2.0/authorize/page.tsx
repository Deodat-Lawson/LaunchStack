import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck, TriangleAlert } from "lucide-react";

import { devRoutesEnabled } from "~/app/dev/enabled";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";

import { StandInBanner } from "../../../../../shared/ui";
import { acceptableRedirect, normalizeScope } from "../../../../dispatch";
import { ACCOUNTS, MICROSOFT_BASE_PATH, TENANT_NAME } from "../../../../world";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { absolute: "Microsoft stand-in" } };

const FILES_TEXT = "Read files in OneDrive and SharePoint";

/** Keyed by lower-cased scope; several scopes can share one line. */
const SCOPE_TEXT: Record<string, string> = {
    openid: "Sign you in",
    profile: "View your basic profile",
    email: "View your email address",
    offline_access: "Maintain access to data you have given it access to",
    "user.read": "Sign you in and read your profile",
    "files.read.all": FILES_TEXT,
    "sites.read.all": FILES_TEXT,
    "mail.read": "Read your mail",
};

/**
 * GET …/{tenant}/oauth2/v2.0/authorize — the stand-in's sign-in and consent
 * screen. Pick which of the tenant's accounts is signing in (`login_hint`
 * preselects one), read what is being asked for, and Allow or Cancel; both
 * post to …/consent, which sends the browser back to the app's redirect_uri.
 * Microsoft's consent is all or nothing, so there are no per-scope boxes.
 */
export default async function MicrosoftConsentPage({
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
    const responseType = one("response_type");
    const hint = one("login_hint")?.toLowerCase();
    const scopes = [
        ...new Set((one("scope") ?? "").split(/\s+/).filter(Boolean).map(normalizeScope)),
    ];
    const problem = !clientId
        ? "The request has no client_id."
        : !acceptableRedirect(redirectUri)
          ? "The redirect_uri is missing or does not point at this machine."
          : responseType !== "code"
            ? "The stand-in only supports response_type=code."
            : scopes.length === 0
              ? "The request asks for no scopes."
              : null;

    // One line per permission, with the scopes that ask for it underneath.
    const permissions = new Map<string, string[]>();
    for (const scope of scopes) {
        const text = SCOPE_TEXT[scope.toLowerCase()] ?? scope;
        permissions.set(text, [...(permissions.get(text) ?? []), scope]);
    }
    const signedIn = ACCOUNTS.find(a => a.email === hint) ?? ACCOUNTS[0]!;

    return (
        <div className="bg-surface text-ink min-h-dvh">
            <StandInBanner network="Microsoft" />
            <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-12">
                <p className="text-ink-3 text-center text-sm font-semibold tracking-wide">
                    Microsoft stand-in
                </p>
                {problem ? (
                    <Card className="gap-3 p-6">
                        <h1 className="display flex items-center gap-2 text-lg font-semibold">
                            <TriangleAlert className="text-danger size-5" aria-hidden />
                            Sorry, but we’re having trouble signing you in
                        </h1>
                        <p className="text-ink-2 text-sm">{problem}</p>
                    </Card>
                ) : (
                    <Card className="gap-5 p-6">
                        <div className="flex flex-col gap-1">
                            <h1 className="display text-lg font-semibold">Permissions requested</h1>
                            <p className="text-ink-3 text-sm">
                                LaunchStack would like to use an account at {TENANT_NAME}.
                            </p>
                        </div>
                        <form
                            method="post"
                            action={`${MICROSOFT_BASE_PATH}/consent`}
                            className="flex flex-col gap-5"
                        >
                            <input type="hidden" name="client_id" value={clientId!} />
                            <input type="hidden" name="redirect_uri" value={redirectUri!} />
                            <input type="hidden" name="scope" value={scopes.join(" ")} />
                            {state !== null ? (
                                <input type="hidden" name="state" value={state} />
                            ) : null}
                            <section className="flex flex-col gap-2">
                                <h2 className="text-ink-2 text-sm font-semibold">Sign in as</h2>
                                <RadioGroup name="account" defaultValue={signedIn.oid}>
                                    {ACCOUNTS.map(account => (
                                        <div key={account.oid} className="flex items-start gap-2">
                                            <RadioGroupItem
                                                id={`account-${account.key}`}
                                                value={account.oid}
                                                className="mt-0.5"
                                            />
                                            <Label
                                                htmlFor={`account-${account.key}`}
                                                className="flex flex-col items-start gap-0.5 font-normal"
                                            >
                                                <span className="text-sm">
                                                    {account.name}
                                                    <span className="text-ink-3">
                                                        {" "}
                                                        · {account.jobTitle}
                                                    </span>
                                                </span>
                                                <span className="text-ink-3 text-xs">
                                                    {account.email}
                                                </span>
                                            </Label>
                                        </div>
                                    ))}
                                </RadioGroup>
                            </section>
                            <section className="flex flex-col gap-2">
                                <h2 className="text-ink-2 text-sm font-semibold">
                                    This app would like to
                                </h2>
                                <ul className="flex flex-col gap-3">
                                    {[...permissions].map(([text, asked]) => (
                                        <li key={text} className="flex items-start gap-2 text-sm">
                                            <ShieldCheck
                                                className="text-success-ink mt-0.5 size-4 shrink-0"
                                                aria-hidden
                                            />
                                            <span>
                                                {text}
                                                <span className="text-ink-3 block break-all font-mono text-[11px]">
                                                    {asked.join(" · ")}
                                                </span>
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
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
