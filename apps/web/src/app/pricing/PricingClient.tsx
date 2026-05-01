'use client';

import Link from 'next/link';
import React from 'react';
import { ArrowRight, Check, Github, Heart, Sparkles } from 'lucide-react';
import { MarketingShell } from '../_components/MarketingShell';
import styles from '../../styles/marketing.module.css';

const GITHUB_REPO = 'https://github.com/Deodat-Lawson/pdr_ai_v2';

export function PricingClient() {
  return (
    <MarketingShell>
      <section className={styles.pageHero}>
        <div className={styles.eyebrow}>Pricing</div>
        <h1 className={styles.pageTitle}>
          Open source. <span className={styles.serif}>Tokens fund the models.</span>
        </h1>
        <p className={styles.pageSub}>
          Launchstack is fully open source under Apache 2.0. Connectors and
          workspaces are unlimited everywhere — hosted plans only differ by
          included tokens (1M free / month, or $4 / month for 6M). Every dollar
          goes to LLM and API keys; fork the repo anytime and run with your own
          keys at unlimited scale.
        </p>
        <div className={styles.heroCtas}>
          <Link href="/signup" className={`${styles.btn} ${styles.btnAccent} ${styles.btnLg}`}>
            Try the demo
            <ArrowRight size={16} />
          </Link>
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.btn} ${styles.btnOutline} ${styles.btnLg}`}
          >
            <Github size={16} />
            View on GitHub
          </a>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.pricingGrid}>
            <PriceCard
              name="Hosted — Free"
              badgeIcon={<Sparkles size={14} />}
              badge="Hosted"
              amount="$0"
              per="/mo"
              tagline="1M tokens / month on our keys — unlimited connectors & workspaces."
              features={[
                '1M tokens / month included',
                'Unlimited connectors',
                'Unlimited workspaces',
                'Document analysis & cited Q&A',
              ]}
              cta="Start free"
              href="/signup"
              variant="outline"
            />
            <PriceCard
              name="Hosted — Plus"
              badgeIcon={<Sparkles size={14} />}
              badge="More tokens"
              amount="$4"
              per="/mo"
              tagline="6M tokens / month — same unlimited connectors & workspaces."
              featured
              features={[
                '6M tokens / month',
                'Unlimited connectors',
                'Unlimited workspaces',
                'All spend covers models & APIs',
              ]}
              cta="Get Plus"
              href="/signup"
              variant="accent"
            />
            <PriceCard
              name="Self-Hosted"
              badgeIcon={<Github size={14} />}
              badge="Open source"
              amount="$0"
              per=" + your keys"
              tagline="Apache 2.0 — deploy anywhere with your own API keys."
              features={[
                'No token limits from us',
                'Unlimited connectors & workspaces',
                'You pay providers directly',
                'Full source on GitHub',
              ]}
              cta="Deployment guide"
              href="/deployment"
              variant="outline"
              secondaryCta={{
                label: 'View on GitHub',
                href: GITHUB_REPO,
              }}
            />
          </div>
        </div>
      </section>

      <section className={styles.sectionTight}>
        <div className={styles.container}>
          <div className={styles.eyebrow}>Backed by</div>
          <h2 className={styles.h2}>
            Built at <span className={styles.serif}>Johns Hopkins.</span>
          </h2>
          <p className={styles.lead}>
            Proudly supported by JHU&rsquo;s commitment to advancing AI
            research and giving professionals cutting-edge tools for the
            everyday work of making sense of information.
          </p>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 18px',
              borderRadius: 14,
              background: 'var(--panel)',
              border: '1px solid var(--line-2)',
            }}
          >
            <Heart size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>Johns Hopkins University</span>
            <span style={{ color: 'var(--ink-3)' }}>·</span>
            <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>Sponsor</span>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

function PriceCard({
  name,
  amount,
  per,
  tagline,
  features,
  cta,
  href,
  variant,
  featured,
  badge,
  badgeIcon,
  secondaryCta,
}: {
  name: string;
  amount: string;
  per: string;
  tagline: string;
  features: string[];
  cta: string;
  href: string;
  variant: 'accent' | 'outline';
  featured?: boolean;
  badge?: string;
  badgeIcon?: React.ReactNode;
  secondaryCta?: { label: string; href: string };
}) {
  return (
    <div className={`${styles.price} ${featured ? styles.priceFeatured : ''}`}>
      {badge && (
        <span className={styles.priceBadge}>
          {badgeIcon}
          <span style={{ marginLeft: badgeIcon ? 6 : 0 }}>{badge}</span>
        </span>
      )}
      <h3>{name}</h3>
      <div className={styles.priceAmount}>
        {amount}
        {per && <span>{per}</span>}
      </div>
      <p className={styles.priceTagline}>{tagline}</p>
      <ul>
        {features.map((f) => (
          <li key={f}>
            <Check size={14} />
            {f}
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto' }}>
        <Link
          href={href}
          className={`${styles.btn} ${variant === 'accent' ? styles.btnAccent : styles.btnOutline}`}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {cta}
        </Link>
        {secondaryCta && (
          <a
            href={secondaryCta.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.btn} ${styles.btnGhost}`}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {secondaryCta.label}
          </a>
        )}
      </div>
    </div>
  );
}
