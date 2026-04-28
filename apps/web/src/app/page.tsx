import type { Metadata } from 'next';
import React from 'react';
import { LandingClient } from './_components/LandingClient';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://launchstack.app';
const GITHUB_REPO = 'https://github.com/Deodat-Lawson/pdr_ai_v2';

export const metadata: Metadata = {
  title: 'Launchstack — The Open-Source Launch Stack for Tech Founders',
  description:
    'Launchstack is the open-source second brain for founders. Turn scattered user calls, investor notes, product specs, and Gmail threads into a living knowledge graph — ask anything, get cited answers.',
  alternates: { canonical: '/' },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Launchstack',
  applicationCategory: 'BusinessApplication',
  applicationSubCategory: 'DeveloperApplication',
  operatingSystem: 'Web',
  description:
    'Launchstack is a free, open-source AI platform that turns scattered docs, recordings, and messages into a cited knowledge graph. Self-host with your own API keys.',
  url: SITE_URL,
  downloadUrl: GITHUB_REPO,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock',
  },
  creator: { '@type': 'Organization', name: 'Launchstack', url: SITE_URL },
  featureList:
    'Document RAG, Predictive Analysis, Contract Review, AI Q&A, Employee Management, Analytics Dashboard, Marketing Pipeline, Self-Hosting',
  screenshot: `${SITE_URL}/og-image.png`,
  softwareVersion: '2.0',
  license: 'https://www.apache.org/licenses/LICENSE-2.0',
};

const organizationLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Launchstack',
  url: SITE_URL,
  logo: `${SITE_URL}/favicon.ico`,
  description:
    'Launchstack builds free, open-source tools that help tech founders grow their products.',
  sameAs: [GITHUB_REPO],
};

const faqLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is Launchstack?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Launchstack is a free, open-source AI platform for tech founders. It turns scattered documents, recordings, and messages into a cited knowledge graph you can query in plain English.',
      },
    },
    {
      '@type': 'Question',
      name: 'Is Launchstack really free?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. Launchstack is 100% free and open source under the Apache 2.0 license. Self-host on your own infrastructure with your own API keys — no usage limits, no hidden costs.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I self-host Launchstack?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Absolutely. Deploy Launchstack on Vercel, Docker, or any server you control. Bring your own API keys and maintain full control over your data.',
      },
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
      <LandingClient />
    </>
  );
}
