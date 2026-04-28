'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Github, Moon, Sun } from 'lucide-react';
import styles from '../../styles/marketing.module.css';

const GITHUB_REPO = 'https://github.com/Deodat-Lawson/pdr_ai_v2';

interface MarketingShellProps {
  children: React.ReactNode;
  navLinks?: Array<{ href: string; label: string }>;
  hideFooter?: boolean;
}

const DEFAULT_LINKS: Array<{ href: string; label: string }> = [
  { href: '/#features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/deployment', label: 'Deployment' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

export function MarketingShell({
  children,
  navLinks = DEFAULT_LINKS,
  hideFooter = false,
}: MarketingShellProps) {
  const [scrolled, setScrolled] = useState(false);
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const isDark = mounted && (resolvedTheme === 'dark' || theme === 'dark');

  return (
    <div className={styles.root}>
      <div className={styles.ambient} aria-hidden="true">
        <div className={`${styles.orb} ${styles.orb1}`} />
        <div className={`${styles.orb} ${styles.orb2}`} />
        <div className={`${styles.orb} ${styles.orb3}`} />
        <div className={`${styles.orb} ${styles.orb4}`} />
        <div className={`${styles.orb} ${styles.orb5}`} />
        <div className={styles.ambientDots} />
        <div className={styles.ambientGrain} />
      </div>

      <nav className={`${styles.nav} ${scrolled ? styles.navScrolled : ''}`}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark} />
          Launchstack
        </Link>
        <div className={styles.navLinks}>
          {navLinks.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </div>
        <div className={styles.navCta}>
          <a
            className={styles.navGh}
            href={GITHUB_REPO}
            target="_blank"
            rel="noopener noreferrer"
            title="Launchstack on GitHub"
          >
            <Github size={16} />
            <span className={styles.label}>Open source</span>
          </a>
          <button
            type="button"
            className={styles.themeToggle}
            aria-label="Toggle theme"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {mounted ? (isDark ? <Sun size={16} /> : <Moon size={16} />) : <Sun size={16} style={{ opacity: 0 }} />}
          </button>
          <Link href="/signin" className={`${styles.btn} ${styles.btnGhost}`}>
            Sign in
          </Link>
          <Link href="/signup" className={`${styles.btn} ${styles.btnAccent}`}>
            Start free →
          </Link>
        </div>
      </nav>

      <div className={styles.pageShell}>{children}</div>

      {!hideFooter && <MarketingFooter />}
    </div>
  );
}

function MarketingFooter() {
  return (
    <footer className={styles.footer}>
      <div>
        <div className={styles.brand} style={{ marginBottom: 12 }}>
          <span className={styles.brandMark} />
          Launchstack
        </div>
        <p className={styles.footTag}>
          The open-source launch stack for tech founders. Document AI, growth
          tools, and team management — built by founders, for founders.
        </p>
      </div>
      <div>
        <h5>Product</h5>
        <ul>
          <li><Link href="/#features">Features</Link></li>
          <li><Link href="/pricing">Pricing</Link></li>
          <li><Link href="/deployment">Deployment</Link></li>
          <li><Link href="/signup">Try it free</Link></li>
        </ul>
      </div>
      <div>
        <h5>Open source</h5>
        <ul>
          <li><a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer">GitHub repo ↗</a></li>
          <li><a href={`${GITHUB_REPO}#readme`} target="_blank" rel="noopener noreferrer">Documentation</a></li>
          <li><Link href="/deployment">Self-host guide</Link></li>
          <li><a href={`${GITHUB_REPO}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">Apache 2.0 license</a></li>
        </ul>
      </div>
      <div>
        <h5>Company</h5>
        <ul>
          <li><Link href="/about">About</Link></li>
          <li><Link href="/contact">Contact</Link></li>
        </ul>
      </div>
      <div className={styles.footBottom}>
        <div>© {new Date().getFullYear()} Launchstack</div>
        <div>Made with care for builders everywhere.</div>
      </div>
    </footer>
  );
}
