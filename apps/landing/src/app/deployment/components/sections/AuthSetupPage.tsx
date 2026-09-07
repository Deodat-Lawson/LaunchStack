"use client";

import React from "react";
import { motion } from "motion/react";
import { Shield, CheckCircle2, Settings } from "lucide-react";
import type { DeploymentProps } from "../../types";
import { Section, Step, InfoBox, WarningBox } from "../ui";
import styles from "~/styles/deployment.module.css";

export const AuthSetupPage: React.FC<DeploymentProps> = ({ copyToClipboard, copiedCode }) => {
    const secretSnippet = `openssl rand -base64 32`;
    const envSnippet = `BETTER_AUTH_SECRET=<the-generated-secret>
# Public origin — set when the app runs behind a proxy or on a real domain
BETTER_AUTH_URL=https://your-app-domain.com`;
    const socialSnippet = `# Optional social sign-in; leave unset for email + password only
AUTH_GOOGLE_CLIENT_ID=<google-oauth-client-id>
AUTH_GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
AUTH_GITHUB_CLIENT_ID=<github-oauth-client-id>
AUTH_GITHUB_CLIENT_SECRET=<github-oauth-client-secret>`;

    return (
        <>
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                style={{ marginBottom: 44 }}
            >
                <div className={styles.pill} style={{ marginBottom: 18 }}>
                    <Shield size={12} /> Core auth
                </div>
                <h1 className={styles.heroTitle}>Authentication setup</h1>
                <p className={styles.heroSub}>
                    Auth is built in — better-auth runs inside the app against your own Postgres.
                    There is no external auth service, no account to create, and nothing to pay for:
                    one generated secret and you are done.
                </p>
            </motion.div>

            <Section title="Configure authentication">
                <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
                    <Step
                        number={1}
                        title="Generate the auth secret"
                        description="Signs session cookies and password-reset tokens. Any strong random value works; 32 base64 bytes is the convention."
                        code={secretSnippet}
                        onCopy={() => copyToClipboard(secretSnippet, "auth-step-1")}
                        copied={copiedCode === "auth-step-1"}
                    />
                    <Step
                        number={2}
                        title="Add it to your environment"
                        description="Set BETTER_AUTH_SECRET wherever the app runs. Add BETTER_AUTH_URL when the app is served behind a proxy or on a public domain, so callbacks resolve to the outside hostname."
                        code={envSnippet}
                        onCopy={() => copyToClipboard(envSnippet, "auth-step-2")}
                        copied={copiedCode === "auth-step-2"}
                    />
                    <Step
                        number={3}
                        title="(Optional) enable social sign-in"
                        description="Email + password works with no further setup. To add Google or GitHub sign-in, create an OAuth app with that provider and set both halves of its key pair — providers appear automatically when configured."
                        code={socialSnippet}
                        onCopy={() => copyToClipboard(socialSnippet, "auth-step-3")}
                        copied={copiedCode === "auth-step-3"}
                    />
                </div>
            </Section>

            <Section title="Validation checklist">
                <InfoBox title="Auth readiness checks" icon={<CheckCircle2 size={18} />}>
                    <ul
                        style={{
                            margin: 0,
                            paddingLeft: 20,
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                        }}
                    >
                        <li>Sign-up and sign-in both work in production</li>
                        <li>Protected routes redirect correctly when unauthenticated</li>
                        <li>User session persists across refresh / navigation</li>
                        <li>Auth tables (pdr_ai_v2_auth_*) exist after migrations run</li>
                    </ul>
                </InfoBox>
            </Section>

            <Section title="Good to know">
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                    <InfoBox
                        title="Rotating the secret signs everyone out"
                        icon={<Settings size={18} />}
                    >
                        <p style={{ margin: 0 }}>
                            Changing BETTER_AUTH_SECRET invalidates every live session — users
                            simply sign in again. Passwords and accounts are unaffected; they live
                            in your database.
                        </p>
                    </InfoBox>
                    <InfoBox
                        title="Password reset needs outbound email"
                        icon={<Settings size={18} />}
                    >
                        <p style={{ margin: 0 }}>
                            Without an email provider configured, sign-in and sign-up work fully; a
                            requested reset link is written to the server log, where an operator can
                            pass it along by hand.
                        </p>
                    </InfoBox>
                    <WarningBox
                        title="Keep secrets out of git"
                        description="Never commit BETTER_AUTH_SECRET to source control. Store it only in your environment variable manager."
                    />
                </div>
            </Section>
        </>
    );
};
