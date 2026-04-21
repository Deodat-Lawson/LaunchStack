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
  const envSnippet = `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_xxx
CLERK_SECRET_KEY=sk_live_xxx`;

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
          Clerk Account & Instance Setup
        </h1>

        <p className={`text-xl ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          Create your Clerk account, configure an application instance, and connect keys to Vercel for production auth.
        </p>
      </motion.div>

      <Section title="Create and Configure Clerk" darkMode={darkMode}>
        <div className="space-y-8">
          <Step
            number={1}
            title="Create Clerk account and application"
            description="In Clerk dashboard, create a new application instance for this project."
            code="Create a new Clerk application instance for Launchstack."
            onCopy={() => copyToClipboard('Create a new Clerk application instance for Launchstack.', 'clerk-step-1')}
            copied={copiedCode === 'clerk-step-1'}
            darkMode={darkMode}
          />

          <Step
            number={2}
            title="Copy Clerk API keys"
            description="From your Clerk application API keys screen, copy both publishable and secret keys."
            code={envSnippet}
            onCopy={() => copyToClipboard(envSnippet, 'clerk-step-2')}
            copied={copiedCode === 'clerk-step-2'}
            darkMode={darkMode}
          />

          <Step
            number={3}
            title="Add keys to Vercel Environment Variables"
            description="Set both keys in Vercel project settings for Production and Preview."
            code={envSnippet}
            onCopy={() => copyToClipboard(envSnippet, 'clerk-step-3')}
            copied={copiedCode === 'clerk-step-3'}
            darkMode={darkMode}
          />

          <Step
            number={4}
            title="Configure redirect URLs"
            description="In Clerk paths/settings, set production sign-in and sign-up redirect URLs to your deployed app domain."
            code={`# example production URLs
https://your-app-domain.com/sign-in
https://your-app-domain.com/sign-up`}
            onCopy={() => copyToClipboard(`# example production URLs
https://your-app-domain.com/sign-in
https://your-app-domain.com/sign-up`, 'clerk-step-4')}
            copied={copiedCode === 'clerk-step-4'}
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
            <li>- No Clerk key warnings in Vercel runtime logs</li>
          </ul>
        </InfoBox>
      </Section>

      <Section title="Common Misconfigurations" darkMode={darkMode}>
        <div className="space-y-6">
          <InfoBox
            title="Production-safe key setup"
            icon={<Settings className="w-6 h-6" />}
            darkMode={darkMode}
          >
            <p className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
              Use live keys for production deployments. If you use test keys, authentication behavior can be inconsistent for real users.
            </p>
          </InfoBox>
          <WarningBox
            title="Important"
            description="Never commit Clerk secret keys to git. Keep secrets only in environment variable managers such as Vercel project settings."
            darkMode={darkMode}
          />
        </div>
      </Section>
    </>
  );
};

