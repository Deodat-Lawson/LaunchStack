'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Shield, CheckCircle2, Settings } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, Step, InfoBox, WarningBox } from '../ui';

export const ClerkSetupPage: React.FC<DeploymentProps> = ({
  darkMode,
  copyToClipboard,
  copiedCode,
}) => {
  const envSnippet = `BETTER_AUTH_SECRET=your-random-secret-here
NEXT_PUBLIC_SITE_URL=https://your-app-domain.com`;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-16"
      >
        <div className={`inline-flex items-center gap-2 px-4 py-2 ${darkMode ? 'bg-indigo-900/50 text-indigo-300' : 'bg-indigo-100 text-indigo-700'} rounded-full font-medium mb-6 text-sm`}>
          <Shield className="w-4 h-4" />
          Core Authentication
        </div>

        <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
          Better Auth Setup
        </h1>

        <p className={`text-xl ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          Configure Better Auth for production authentication. No external service required — auth runs entirely on your own infrastructure.
        </p>
      </motion.div>

      <Section title="Configure Better Auth" darkMode={darkMode}>
        <div className="space-y-8">
          <Step
            number={1}
            title="Generate a secret key"
            description="Generate a strong random secret for signing session tokens."
            code="openssl rand -base64 32"
            onCopy={() => copyToClipboard('openssl rand -base64 32', 'auth-step-1')}
            copied={copiedCode === 'auth-step-1'}
            darkMode={darkMode}
          />

          <Step
            number={2}
            title="Set environment variables"
            description="Add the secret and your application URL to your environment."
            code={envSnippet}
            onCopy={() => copyToClipboard(envSnippet, 'auth-step-2')}
            copied={copiedCode === 'auth-step-2'}
            darkMode={darkMode}
          />

          <Step
            number={3}
            title="Run database migration"
            description="Push the auth tables to your database."
            code="pnpm db:push"
            onCopy={() => copyToClipboard('pnpm db:push', 'auth-step-3')}
            copied={copiedCode === 'auth-step-3'}
            darkMode={darkMode}
          />
        </div>
      </Section>

      <Section title="Validation Checklist" darkMode={darkMode}>
        <InfoBox
          title="Auth readiness checks"
          icon={<CheckCircle2 className="w-6 h-6" />}
          darkMode={darkMode}
        >
          <ul className={`space-y-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            <li>- Sign-up and sign-in both work in production</li>
            <li>- Protected routes redirect correctly when unauthenticated</li>
            <li>- User session persists across refresh/navigation</li>
            <li>- Password reset flow works end-to-end</li>
          </ul>
        </InfoBox>
      </Section>

      <Section title="Common Misconfigurations" darkMode={darkMode}>
        <div className="space-y-6">
          <InfoBox
            title="Production-safe setup"
            icon={<Settings className="w-6 h-6" />}
            darkMode={darkMode}
          >
            <p className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
              Use a unique, strong BETTER_AUTH_SECRET for each environment. Ensure NEXT_PUBLIC_SITE_URL matches your production domain exactly (including https://).
            </p>
          </InfoBox>
          <WarningBox
            title="Important"
            description="Never commit BETTER_AUTH_SECRET to git. Keep secrets only in environment variable managers such as Vercel project settings or Docker secrets."
            darkMode={darkMode}
          />
        </div>
      </Section>
    </>
  );
};
