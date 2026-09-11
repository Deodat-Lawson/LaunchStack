"use client";

import Link from "next/link";
import React from "react";
import { ArrowRight, Check, Github, Sparkles } from "lucide-react";
import { MarketingShell } from "../_components/MarketingShell";
import styles from "../../styles/marketing.module.css";

const GITHUB_REPO = "https://github.com/Deodat-Lawson/LaunchStack";

export function PricingClient() {
    return (
        <MarketingShell>
            <section className={styles.pageHero}>
                <div className={styles.eyebrow}>Pricing</div>
                <h1 className={styles.pageTitle}>
                    Open source. <span className={styles.serif}>Nothing is for sale today.</span>
                </h1>
                <p className={styles.pageSub}>
                    Launchstack is fully open source under Apache 2.0. Self-hosting is the offering:
                    run the entire stack on your own infrastructure with your own API keys, at
                    whatever scale your hardware allows. A managed cloud version is on the roadmap —
                    there is no paid plan and no billing yet.
                </p>
                <div className={styles.heroCtas}>
                    <Link
                        href="/deployment"
                        className={`${styles.btn} ${styles.btnAccent} ${styles.btnLg}`}
                    >
                        Deployment guide
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
                            name="Self-Hosted"
                            badgeIcon={<Github size={14} />}
                            badge="Available now"
                            amount="$0"
                            per=" + your keys"
                            tagline="Apache 2.0 — deploy anywhere with your own API keys."
                            featured
                            features={[
                                "Full source on GitHub",
                                "You pay AI providers directly — no token limits from us",
                                "Docker Compose stack: app, worker, Postgres + pgvector, compute services",
                                "Your data stays in your Postgres and object storage",
                            ]}
                            cta="Deployment guide"
                            href="/deployment"
                            variant="accent"
                            secondaryCta={{
                                label: "View on GitHub",
                                href: GITHUB_REPO,
                            }}
                        />
                        <PriceCard
                            name="Cloud"
                            badgeIcon={<Sparkles size={14} />}
                            badge="Coming soon"
                            amount="Coming soon"
                            per=""
                            tagline="A managed version is planned. Nothing to buy yet — no billing exists."
                            features={[
                                "On the roadmap — not available today",
                                "Watch the repository for updates",
                            ]}
                            cta="Watch on GitHub"
                            href={GITHUB_REPO}
                            variant="outline"
                        />
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
    variant: "accent" | "outline";
    featured?: boolean;
    badge?: string;
    badgeIcon?: React.ReactNode;
    secondaryCta?: { label: string; href: string };
}) {
    return (
        <div className={`${styles.price} ${featured ? styles.priceFeatured : ""}`}>
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
                {features.map(f => (
                    <li key={f}>
                        <Check size={14} />
                        {f}
                    </li>
                ))}
            </ul>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
                <Link
                    href={href}
                    className={`${styles.btn} ${variant === "accent" ? styles.btnAccent : styles.btnOutline}`}
                    style={{ width: "100%", justifyContent: "center" }}
                >
                    {cta}
                </Link>
                {secondaryCta && (
                    <a
                        href={secondaryCta.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${styles.btn} ${styles.btnGhost}`}
                        style={{ width: "100%", justifyContent: "center" }}
                    >
                        {secondaryCta.label}
                    </a>
                )}
            </div>
        </div>
    );
}
