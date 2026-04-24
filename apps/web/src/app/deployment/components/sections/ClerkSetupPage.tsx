'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Shield, CheckCircle2, Settings } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, Step, InfoBox, WarningBox } from '../ui';
import styles from '~/styles/deployment.module.css';

export const ClerkSetupPage: React.FC<DeploymentProps> = ({
  copyToClipboard,
  copiedCode,
}) => {
  const envSnippet = `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_xxx
CLERK_SECRET_KEY=sk_live_xxx`;

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
        <h1 className={styles.heroTitle}>Clerk account &amp; instance setup</h1>
        <p className={styles.heroSub}>
          Create a Clerk application, configure redirect URLs, and wire the keys to your
          deployment environment for production-grade auth.
        </p>
      </motion.div>

      <Section title="Create and configure Clerk">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <Step
            number={1}
            title="Create Clerk account and application"
            description="In the Clerk dashboard, create a new application instance for this project."
            code="Create a new Clerk application instance for Launchstack."
            onCopy={() => copyToClipboard('Create a new Clerk application instance for Launchstack.', 'clerk-step-1')}
            copied={copiedCode === 'clerk-step-1'}
          />
          <Step
            number={2}
            title="Copy Clerk API keys"
            description="From your Clerk application API keys screen, copy both publishable and secret keys."
            code={envSnippet}
            onCopy={() => copyToClipboard(envSnippet, 'clerk-step-2')}
            copied={copiedCode === 'clerk-step-2'}
          />
          <Step
            number={3}
            title="Add keys to environment variables"
            description="Set both keys in your deployment's environment (Vercel, Docker, or wherever you host) for Production and Preview."
            code={envSnippet}
            onCopy={() => copyToClipboard(envSnippet, 'clerk-step-3')}
            copied={copiedCode === 'clerk-step-3'}
          />
          <Step
            number={4}
            title="Configure redirect URLs"
            description="In Clerk paths settings, set production sign-in and sign-up redirect URLs to your deployed app domain."
            code={`# example production URLs
https://your-app-domain.com/sign-in
https://your-app-domain.com/sign-up`}
            onCopy={() =>
              copyToClipboard(
                `# example production URLs\nhttps://your-app-domain.com/sign-in\nhttps://your-app-domain.com/sign-up`,
                'clerk-step-4',
              )
            }
            copied={copiedCode === 'clerk-step-4'}
          />
        </div>
      </Section>

      <Section title="Validation checklist">
        <InfoBox title="Auth readiness checks" icon={<CheckCircle2 size={18} />}>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>Sign-up and sign-in both work in production</li>
            <li>Protected routes redirect correctly when unauthenticated</li>
            <li>User session persists across refresh / navigation</li>
            <li>No Clerk key warnings in runtime logs</li>
          </ul>
        </InfoBox>
      </Section>

      <Section title="Common misconfigurations">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <InfoBox title="Use live keys in production" icon={<Settings size={18} />}>
            <p style={{ margin: 0 }}>
              Test keys can produce inconsistent auth behavior for real users.
              Make sure production uses <code className={styles.mono}>pk_live_*</code> and <code className={styles.mono}>sk_live_*</code>.
            </p>
          </InfoBox>
          <WarningBox
            title="Keep secrets out of git"
            description="Never commit Clerk secret keys to source control. Store them only in your environment variable manager."
          />
        </div>
      </Section>
    </>
  );
};
