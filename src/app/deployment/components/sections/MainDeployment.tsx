'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Terminal, Database, Shield, Zap, Github } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, Step, PrerequisiteCard, ApiKeyCard, InfoBox } from '../ui';

export const MainDeployment: React.FC<DeploymentProps> = ({ 
  darkMode, 
  copyToClipboard, 
  copiedCode 
}) => {
  return (
    <>
      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-16"
      >
        <div className={`inline-flex items-center gap-2 px-4 py-2 ${darkMode ? 'bg-purple-900/50 text-purple-300' : 'bg-purple-100 text-purple-700'} rounded-full font-medium mb-6 text-sm`}>
          <Terminal className="w-4 h-4" />
          Core Deployment Guide
        </div>

        <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
          Deploy PDR AI
        </h1>

        <p className={`text-xl ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-8`}>
          Get started with the core features. Optional integrations available in the sidebar.
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <a
            href="https://github.com/Deodat-Lawson/pdr_ai_v2"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
          >
            <Github className="w-5 h-5" />
            View on GitHub
          </a>
        </div>
      </motion.div>

      {/* Prerequisites */}
      <Section title="Prerequisites" darkMode={darkMode}>
        <div className="grid md:grid-cols-3 gap-6">
          <PrerequisiteCard
            icon={<Terminal className="w-8 h-8" />}
            title="Node.js & Package Manager"
            items={['Node.js v18.0+', 'pnpm or npm', 'Git']}
            darkMode={darkMode}
          />
          <PrerequisiteCard
            icon={<Database className="w-8 h-8" />}
            title="Database"
            items={['PostgreSQL 14+', 'Neon (recommended)', 'Docker (local dev)']}
            darkMode={darkMode}
          />
          <PrerequisiteCard
            icon={<Shield className="w-8 h-8" />}
            title="Core API Keys"
            items={['OpenAI API', 'Clerk Auth']}
            darkMode={darkMode}
          />
        </div>
      </Section>

      {/* Quick Start */}
      <Section title="Quick Start" darkMode={darkMode}>
        <div className="space-y-8">
          <Step
            number={1}
            title="Clone Repository"
            code="git clone https://github.com/Deodat-Lawson/pdr_ai_v2.git\ncd pdr_ai_v2"
            onCopy={() => copyToClipboard('git clone https://github.com/Deodat-Lawson/pdr_ai_v2.git\ncd pdr_ai_v2', 'step-1')}
            copied={copiedCode === 'step-1'}
            darkMode={darkMode}
          />

          <Step
            number={2}
            title="Install Dependencies"
            code="pnpm install"
            onCopy={() => copyToClipboard('pnpm install', 'step-2')}
            copied={copiedCode === 'step-2'}
            darkMode={darkMode}
          />

          <Step
            number={3}
            title="Configure Core Environment Variables"
            description="Create a .env file with these essential variables:"
            code={`# ============ DATABASE (Required) ============
DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"

# ============ AUTHENTICATION (Required) ============
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
CLERK_SECRET_KEY=sk_test_your_key_here

# ============ AI (Required) ============
OPENAI_API_KEY=sk-proj-your_key_here`}
            onCopy={() => copyToClipboard(`# ============ DATABASE (Required) ============
DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"

# ============ AUTHENTICATION (Required) ============
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
CLERK_SECRET_KEY=sk_test_your_key_here

# ============ AI (Required) ============
OPENAI_API_KEY=sk-proj-your_key_here`, 'step-3')}
            copied={copiedCode === 'step-3'}
            darkMode={darkMode}
          />

          <Step
            number={4}
            title="Set Up Database"
            code="# Enable pgvector extension\nCREATE EXTENSION IF NOT EXISTS vector;\n\n# Run migrations\npnpm db:push"
            onCopy={() => copyToClipboard('pnpm db:push', 'step-4')}
            copied={copiedCode === 'step-4'}
            darkMode={darkMode}
          />

          <Step
            number={5}
            title="Start Development"
            code="pnpm dev"
            onCopy={() => copyToClipboard('pnpm dev', 'step-5')}
            copied={copiedCode === 'step-5'}
            darkMode={darkMode}
          />
        </div>
      </Section>

      {/* API Keys Setup */}
      <Section title="Core API Keys Setup" darkMode={darkMode}>
        <div className="space-y-6">
          <ApiKeyCard
            title="1. Database (Neon PostgreSQL)"
            link="https://neon.tech"
            description="Serverless PostgreSQL with built-in pgvector support"
            steps={[
              'Create account at neon.tech',
              'Create new project with PostgreSQL 14+',
              'Copy connection string from dashboard',
              'Add DATABASE_URL to .env',
              'Enable pgvector: CREATE EXTENSION IF NOT EXISTS vector;'
            ]}
            darkMode={darkMode}
          />

          <ApiKeyCard
            title="2. Clerk Authentication"
            link="https://clerk.com"
            description="User authentication and management"
            steps={[
              'Create account at clerk.com',
              'Create new application',
              'Copy publishable and secret keys',
              'Add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to .env'
            ]}
            darkMode={darkMode}
          />

          <ApiKeyCard
            title="3. OpenAI API"
            link="https://platform.openai.com"
            description="AI-powered document analysis and Q&A"
            steps={[
              'Create account at platform.openai.com',
              'Navigate to API keys section',
              'Create new API key',
              'Add OPENAI_API_KEY to .env',
              'Set up billing for API usage'
            ]}
            darkMode={darkMode}
          />

        </div>
      </Section>

      {/* Production Deployment */}
      <Section title="Production Deployment" darkMode={darkMode}>
        <InfoBox
          title="Vercel Deployment (Recommended)"
          icon={<Zap className="w-6 h-6" />}
          darkMode={darkMode}
        >
          <ol className={`space-y-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-semibold">1</span>
              <span>Push code to GitHub: <code className={`${darkMode ? 'bg-gray-800' : 'bg-gray-100'} px-2 py-1 rounded`}>git push origin main</code></span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-semibold">2</span>
              <span>Import repository on <a href="https://vercel.com" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Vercel.com</a></span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-semibold">3</span>
              <span>Add all environment variables in Settings → Environment Variables</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-semibold">4</span>
              <span>Deploy! Your app will be live at your-app.vercel.app</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-semibold">5</span>
              <span>(Optional) For background processing, see <strong>Inngest</strong> in the sidebar</span>
            </li>
          </ol>
        </InfoBox>
      </Section>
    </>
  );
};

