import type { Metadata } from "next";
import React from "react";
import { LegalPage } from "../_components/LegalPage";
import styles from "../../styles/marketing.module.css";
import { APP_URL, PRIVACY_EMAIL } from "~/config/site";

export const metadata: Metadata = {
    title: "Privacy Policy",
    description:
        "What Launchstack collects, how it is used, who processes it, how Google user data is handled, and how to delete your data.",
    alternates: { canonical: "/privacy" },
};

const GOOGLE_USER_DATA_POLICY =
    "https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes";

export default function PrivacyPage() {
    const appHost = new URL(APP_URL).host;
    const mailto = `mailto:${PRIVACY_EMAIL}`;

    return (
        <LegalPage
            eyebrow="Legal"
            title="Privacy Policy"
            summary={
                <p>
                    Launchstack stores the files, notes and chats you put into your workspace so you
                    can search them and ask questions about them. We use your data only to run the
                    service for you. We don&rsquo;t sell it, we don&rsquo;t use it for advertising,
                    and we don&rsquo;t use it to train AI models. You can delete your content at any
                    time, and you can ask us to delete your account by writing to{" "}
                    <a href={mailto}>{PRIVACY_EMAIL}</a>.
                </p>
            }
        >
            <h2>Who we are</h2>
            <p>
                This policy covers the hosted Launchstack service at <strong>{appHost}</strong> and
                this website. In this policy, &ldquo;Launchstack&rdquo;, &ldquo;we&rdquo; and
                &ldquo;us&rdquo; mean the team that operates that service. Questions go to{" "}
                <a href={mailto}>{PRIVACY_EMAIL}</a>.
            </p>
            <p>
                Launchstack is also open-source software that anyone can run on their own servers.
                If you use a copy that someone else hosts, that operator decides how your data is
                handled, and this policy does not apply to it.
            </p>

            <h2>What we collect</h2>
            <h3>Your account</h3>
            <ul>
                <li>
                    Your name, email address and password. Passwords are stored only as a salted
                    hash.
                </li>
                <li>
                    If you sign in with Google, the name, email address and profile photo on your
                    Google account.
                </li>
                <li>
                    Anything you add to your profile, such as a photo, display name, job title,
                    pronouns or time zone.
                </li>
            </ul>
            <h3>Your workspace</h3>
            <ul>
                <li>
                    Files you upload, documents and mind maps you create, notes, chats, and the
                    answers Launchstack generates for you.
                </li>
                <li>
                    Text extracted from your files so they can be searched, including transcripts of
                    audio and video and text read from scanned pages.
                </li>
                <li>
                    Workspace members, roles, sharing settings, and a record of actions such as
                    sharing a file, so admins can see who did what.
                </li>
                <li>Settings and preferences you choose.</li>
            </ul>
            <h3>Accounts you connect</h3>
            <p>
                If you connect Google Drive, Gmail, LinkedIn or Bluesky, we store the access token
                that service gives us and the data described under{" "}
                <a href="#google-user-data">Google user data</a> and{" "}
                <a href="#sharing">who we share data with</a>. You can disconnect at any time.
            </p>
            <h3>Technical information</h3>
            <p>
                Your IP address, browser type and server logs, which we need to keep the service
                running and secure. We use cookies only to keep you signed in and to remember
                preferences such as your theme. We don&rsquo;t use advertising or cross-site
                tracking cookies.
            </p>

            <h2>How we use it</h2>
            <ul>
                <li>
                    To provide the service: storing your content, making it searchable, answering
                    your questions with citations, transcribing media, reading scanned documents,
                    and publishing posts you schedule.
                </li>
                <li>To keep accounts and workspaces secure and to prevent abuse.</li>
                <li>To respond when you contact us.</li>
            </ul>
            <p>
                We don&rsquo;t sell personal data, we don&rsquo;t show ads, and we don&rsquo;t use
                your content to train AI models.
            </p>

            <h2>AI processing</h2>
            <p>
                When you ask a question, upload a file or use an AI feature, the relevant text is
                sent to an AI model to produce the result: your question plus the passages from your
                workspace it needs. Models are reached through OpenRouter, which forwards each
                request to the model provider, such as Google or OpenAI. Audio and video are
                transcribed with Google&rsquo;s Gemini API, and scanned documents are read with
                Microsoft Azure Document Intelligence. We send content to these providers only to
                produce the result you asked for, through their business APIs.
            </p>

            <h2 id="google-user-data">Google user data</h2>
            <p>
                Launchstack can connect to your Google account. Here is exactly what it accesses and
                why.
            </p>
            <ul>
                <li>
                    <strong>Sign in with Google</strong> uses your name, email address and profile
                    photo to create and identify your account.
                </li>
                <li>
                    <strong>Google Drive</strong> (the <code>drive.file</code> permission) gives
                    access only to files you pick in Launchstack or that Launchstack creates. We
                    read those files to add them to your workspace, and we create and update linked
                    copies in a &ldquo;LaunchStack&rdquo; folder in your Drive. We can&rsquo;t see
                    any other files in your Drive.
                </li>
                <li>
                    <strong>Gmail</strong> (the <code>gmail.readonly</code> permission) lets us read
                    your email messages so they can be searched and cited in your workspace. Synced
                    messages go into a private folder that only you can see. Launchstack never
                    sends, changes or deletes email.
                </li>
            </ul>
            <p>How we treat this data:</p>
            <ul>
                <li>
                    We use it only to provide the features you turned on, which are visible to you
                    in the product.
                </li>
                <li>
                    We transfer it only to the service providers needed to run those features
                    (hosting, and the AI processing described above), when the law requires it, or
                    with your permission.
                </li>
                <li>We don&rsquo;t sell it and we don&rsquo;t use it for advertising.</li>
                <li>
                    We don&rsquo;t use it to develop, improve or train generalized or
                    non-personalized AI or machine-learning models.
                </li>
                <li>
                    People don&rsquo;t read it, unless you ask us to for support, it&rsquo;s needed
                    to investigate abuse or a security problem, or the law requires it.
                </li>
            </ul>
            <p>
                Launchstack&rsquo;s use and transfer of information received from Google APIs to any
                other app will adhere to the{" "}
                <a href={GOOGLE_USER_DATA_POLICY} target="_blank" rel="noopener noreferrer">
                    Google API Services User Data Policy
                </a>
                , including the Limited Use requirements.
            </p>
            <p>
                <strong>Disconnecting.</strong> You can disconnect Google Drive or Gmail in
                Launchstack&rsquo;s settings, or remove Launchstack at{" "}
                <a
                    href="https://myaccount.google.com/permissions"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    myaccount.google.com/permissions
                </a>
                . Disconnecting deletes our access token and revokes our access with Google. Files
                in your Google Drive are never deleted. Emails and documents already synced into
                your workspace stay there until you delete them, or until you ask us to delete them.
            </p>

            <h2 id="sharing">Who we share data with</h2>
            <p>
                Inside Launchstack, files and chats are private to you by default. Other members of
                your workspace can see them only when you share them, or when you put them in a
                folder they can access.
            </p>
            <p>Outside Launchstack, these providers process data on our behalf:</p>
            <div className={styles.legalTable}>
                <table>
                    <thead>
                        <tr>
                            <th>Provider</th>
                            <th>What for</th>
                            <th>What they receive</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Microsoft Azure (United States)</td>
                            <td>
                                Hosting, file storage, database backups, and reading scanned
                                documents
                            </td>
                            <td>The data stored in the service, and scanned pages you upload</td>
                        </tr>
                        <tr>
                            <td>OpenRouter, and the model providers it routes to</td>
                            <td>AI answers, summaries and search indexing</td>
                            <td>Your question and the passages from your workspace it needs</td>
                        </tr>
                        <tr>
                            <td>Google</td>
                            <td>
                                Sign-in, Drive and Gmail when you connect them, and transcription
                                through the Gemini API
                            </td>
                            <td>What each feature needs, as described above</td>
                        </tr>
                        <tr>
                            <td>Inngest</td>
                            <td>Scheduling background tasks</td>
                            <td>The details a task needs to run</td>
                        </tr>
                        <tr>
                            <td>LinkedIn and Bluesky</td>
                            <td>Publishing posts, only if you connect them</td>
                            <td>The posts and images you choose to publish</td>
                        </tr>
                        <tr>
                            <td>EmailJS</td>
                            <td>
                                Delivering messages sent through this website&rsquo;s contact form
                            </td>
                            <td>Your name, email address and message</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p>
                We may also disclose data if the law requires it, to protect people&rsquo;s safety
                or the security of the service, or as part of a merger or sale of the service. If
                that happens, this policy keeps applying to your data.
            </p>

            <h2>How long we keep data</h2>
            <ul>
                <li>
                    Your content stays in your workspace until you delete it or ask us to delete
                    your account.
                </li>
                <li>Deleting a document removes it from your workspace and from search results.</li>
                <li>Database backups are kept for 30 days and then deleted.</li>
                <li>
                    When you ask us to delete your account, we delete your account and the content
                    you own within 30 days. Copies in backups expire within a further 30 days.
                </li>
            </ul>

            <h2>Security</h2>
            <p>
                Connections to Launchstack are encrypted with HTTPS, passwords are stored as hashes,
                service credentials are kept in a managed secrets vault, and the servers run on
                encrypted disks. Access inside a workspace follows the roles and sharing settings
                its members choose. No system is perfectly secure; if we learn of a breach that
                affects your data, we&rsquo;ll tell you.
            </p>

            <h2>Your choices and rights</h2>
            <p>
                You can view, edit and delete your content and profile in the product. To get a copy
                of your data, correct something you can&rsquo;t change yourself, or delete your
                account, write to <a href={mailto}>{PRIVACY_EMAIL}</a>. We&rsquo;ll reply within 30
                days. Depending on where you live, you may have further rights, such as objecting to
                certain processing. Ask us and we&rsquo;ll help.
            </p>

            <h2>Children</h2>
            <p>
                Launchstack is not meant for children under 13, and we don&rsquo;t knowingly collect
                their data. If you think a child has given us data, contact us and we&rsquo;ll
                delete it.
            </p>

            <h2>Where data is stored</h2>
            <p>
                The service runs in Microsoft Azure data centers in the United States. If you use
                Launchstack from another country, your data is transferred to and stored in the
                United States.
            </p>

            <h2>Changes to this policy</h2>
            <p>
                When we change this policy we&rsquo;ll update the date at the top. If a change
                materially affects how we use your data, we&rsquo;ll tell you in the product or by
                email before it takes effect.
            </p>

            <h2>Contact</h2>
            <p>
                Write to <a href={mailto}>{PRIVACY_EMAIL}</a> with any question about this policy or
                your data.
            </p>
        </LegalPage>
    );
}
