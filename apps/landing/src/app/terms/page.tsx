import type { Metadata } from "next";
import Link from "next/link";
import React from "react";
import { LegalPage } from "../_components/LegalPage";
import { APP_URL, GITHUB_REPO, PRIVACY_EMAIL } from "~/config/site";

export const metadata: Metadata = {
    title: "Terms of Service",
    description:
        "The terms for using the hosted Launchstack service: your account, your content, acceptable use, AI output, and our responsibilities.",
    alternates: { canonical: "/terms" },
};

export default function TermsPage() {
    const appHost = new URL(APP_URL).host;
    const mailto = `mailto:${PRIVACY_EMAIL}`;

    return (
        <LegalPage
            eyebrow="Legal"
            title="Terms of Service"
            summary={
                <p>
                    You own what you put into Launchstack. We host and process it only to run the
                    service for you. Use Launchstack lawfully, check what the AI tells you before
                    relying on it, and keep your account secure. The service is provided as it is,
                    and it is still changing.
                </p>
            }
        >
            <h2>1. These terms</h2>
            <p>
                These terms apply when you use the hosted Launchstack service at{" "}
                <strong>{appHost}</strong> or this website. &ldquo;Launchstack&rdquo;,
                &ldquo;we&rdquo; and &ldquo;us&rdquo; mean the team that operates that service. By
                creating an account or using the service, you agree to these terms and to our{" "}
                <Link href="/privacy">Privacy Policy</Link>. If you use Launchstack on behalf of an
                organization, you confirm that you can accept these terms for it.
            </p>
            <p>
                The Launchstack source code is a separate matter. It is published under the{" "}
                <a
                    href={`${GITHUB_REPO}/blob/main/LICENSE`}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Apache 2.0 license
                </a>
                , and that license, not these terms, governs copies you run yourself.
            </p>

            <h2>2. Your account</h2>
            <ul>
                <li>
                    Give accurate sign-up details, keep your password private, and tell us if you
                    think someone else has accessed your account.
                </li>
                <li>You&rsquo;re responsible for what happens under your account.</li>
                <li>You must be at least 13 years old to use Launchstack.</li>
                <li>
                    Workspace owners and admins control who can join a workspace and what each
                    member can see and do.
                </li>
            </ul>

            <h2>3. Your content</h2>
            <p>
                You keep ownership of everything you upload, create or connect. You give us
                permission to store, copy, process and display your content only as needed to run
                the service for you and the people you share it with. That includes sending relevant
                passages to the AI providers listed in the Privacy Policy to produce answers. This
                permission ends when you delete the content or your account, except for copies in
                backups, which expire on the schedule in the Privacy Policy.
            </p>
            <p>
                Only upload content you have the right to use, and don&rsquo;t connect accounts you
                aren&rsquo;t allowed to connect.
            </p>

            <h2>4. Acceptable use</h2>
            <p>Don&rsquo;t use Launchstack to:</p>
            <ul>
                <li>break the law, or infringe anyone&rsquo;s intellectual property or privacy;</li>
                <li>upload malware, or try to get around security or access controls;</li>
                <li>
                    access other people&rsquo;s workspaces or data without permission, or probe,
                    scrape or overload the service;
                </li>
                <li>
                    send spam or misleading posts through the social publishing features, or break
                    the rules of the networks you publish to;
                </li>
                <li>
                    generate content that harasses people, sexualizes minors, or helps anyone cause
                    serious harm.
                </li>
            </ul>
            <p>We may remove content or suspend accounts that break these rules.</p>

            <h2>5. AI features</h2>
            <p>
                Launchstack uses AI models to answer questions, summarize and draft. AI output can
                be wrong or incomplete, even when it cites your sources. Check important answers
                against the cited documents, and don&rsquo;t treat output as legal, financial,
                medical or other professional advice. You&rsquo;re responsible for how you use what
                Launchstack produces.
            </p>

            <h2>6. Connected services</h2>
            <p>
                If you connect Google, LinkedIn, Bluesky or another service, your use of that
                service is also governed by its own terms. We aren&rsquo;t responsible for
                third-party services, or for changes they make that affect an integration.
            </p>

            <h2>7. Price and changes to the service</h2>
            <p>
                The hosted service is currently free. If we introduce paid features, we&rsquo;ll
                tell you the price before you&rsquo;re charged anything. Launchstack is under active
                development: features may change, move or be removed, and the service may sometimes
                be unavailable. We&rsquo;ll try to give notice before removing something you rely
                on.
            </p>

            <h2>8. Ending your use</h2>
            <p>
                You can stop using Launchstack at any time, and you can ask us to delete your
                account by writing to <a href={mailto}>{PRIVACY_EMAIL}</a>. We may suspend or close
                an account that breaks these terms or puts the service or other users at risk. Where
                we can, we&rsquo;ll tell you first and give you a chance to export your content.
                After an account is closed, its data is deleted as described in the Privacy Policy.
            </p>

            <h2>9. Disclaimers</h2>
            <p>
                The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the
                extent the law allows, we make no warranties, express or implied, including
                warranties of merchantability, fitness for a particular purpose, and
                non-infringement. We don&rsquo;t promise that the service will be uninterrupted or
                error-free, or that it will never lose data. Keep your own copies of anything
                important.
            </p>

            <h2>10. Limitation of liability</h2>
            <p>
                To the extent the law allows, we aren&rsquo;t liable for indirect, incidental,
                special, consequential or punitive damages, or for lost profits, revenue or data.
                Our total liability for any claim about the service is limited to the greater of the
                amount you paid us in the 12 months before the claim, or US$100. Some places
                don&rsquo;t allow these limits, so they may not all apply to you.
            </p>

            <h2>11. Changes to these terms</h2>
            <p>
                When we change these terms we&rsquo;ll update the date at the top. If a change is
                material, we&rsquo;ll tell you in the product or by email before it takes effect. If
                you keep using Launchstack after that, the new terms apply.
            </p>

            <h2>12. Contact</h2>
            <p>
                Questions about these terms go to <a href={mailto}>{PRIVACY_EMAIL}</a>.
            </p>
        </LegalPage>
    );
}
