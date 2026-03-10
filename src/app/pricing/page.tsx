import Link from "next/link";
import React from 'react';
import { Brain, Check, Users, Heart, Award, GraduationCap } from 'lucide-react';
import styles from '../../styles/pricing.module.css';
import Image from "next/image";
import { Navbar } from '../_components/Navbar';
import {
    ClerkProvider,
    SignUpButton,
} from '@clerk/nextjs'

export default function PricingPage() {
    return (
        <ClerkProvider>
            <div className={styles.container}>
                <Navbar />

                <div className={styles.heroSection}>
                    <div className={styles.heroContent}>
                        <h1 className={styles.heroTitle}>
                            Open Source & Self-Deployable
                        </h1>
                        <p className={styles.heroDescription}>
                            Deploy PDR AI with your own API keys - this website serves as a free demo
                        </p>
                    </div>
                </div>

                <div className={styles.sponsorshipSection}>
                    <div className={styles.sponsorshipContainer}>
                        <div className={styles.sponsorshipContent}>
                            <div className={styles.sponsorshipBadge}>
                                <Heart className={styles.heartIcon} />
                                <span>Proudly Sponsored By</span>
                            </div>
                            <div className={styles.universityLogo}>
                                <div className={styles.logoPlaceholder}>
                                    <Image
                                        src="https://iiazjw8b8a.ufs.sh/f/zllPuoqtDQmM5spvD3EI3EhyDsbv87pB2AlOH1udg6mXVtkK"
                                        alt="Johns Hopkins University"
                                        width={100}
                                        height={100}
                                        className="rounded-lg"
                                    />
                                    <div className={styles.universityText}>
                                        <h3>Johns Hopkins University</h3>
                                    </div>
                                </div>
                            </div>
                            <p className={styles.sponsorshipDescription}>
                                This project is made possible through the generous support of Johns Hopkins University&apos;s
                                commitment to advancing AI research and providing cutting-edge tools to professionals worldwide.
                            </p>
                        </div>
                    </div>
                </div>

                <div className={styles.pricingSection}>
                    <div className={styles.pricingContainer}>

                        <div className={styles.pricingCard}>
                            <div className={styles.cardHeader}>
                                <div className={styles.planBadge}>
                                    <Award className={styles.awardIcon} />
                                    <span>Demo Access</span>
                                </div>
                                <h2 className={styles.planTitle}>Demo Access</h2>
                                <div className={styles.priceContainer}>
                                    <span className={styles.price}>Free</span>
                                </div>
                                <p className={styles.planDescription}>
                                    This is a demo version of PDR AI for testing and exploration.
                                </p>
                            </div>

                            <div className={styles.featuresContainer}>
                                <h3 className={styles.featuresTitle}>Demo Access Features:</h3>
                                <ul className={styles.featuresList}>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Document Analysis</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Predictive Document Analysis</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>AI-Powered Q&A Engine</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Company Management Tools</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Employee Management System</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Analytics & Insights Dashboard</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Enterprise-Grade Security</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>24/7 Technical Support</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Regular Feature Updates</span>
                                    </li>
                                </ul>
                            </div>

                            <div className={styles.ctaContainer}>
                                <SignUpButton>
                                    <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`}>
                                        Try Demo Now
                                    </button>
                                </SignUpButton>
                            </div>
                        </div>


                        <div className={styles.pricingCard}>
                            <div className={styles.cardHeader}>
                                <div className={styles.planBadge}>
                                    <Award className={styles.awardIcon} />
                                    <span>Open Source</span>
                                </div>
                                <h2 className={styles.planTitle}>Self-Deployable Solution</h2>
                                <div className={styles.priceContainer}>
                                    <span className={styles.price}>Free</span>
                                    <span className={styles.priceSubtext}>with your API keys</span>
                                </div>
                                <p className={styles.planDescription}>
                                    Deploy PDR AI on your own infrastructure with your API keys. This website is a free demo for testing and exploration.
                                </p>
                            </div>

                            <div className={styles.featuresContainer}>
                                <h3 className={styles.featuresTitle}>Everything Included:</h3>
                                <ul className={styles.featuresList}>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Unlimited Document Analysis</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Predictive Document Analysis</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>AI-Powered Q&A Engine</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Company Management Tools</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Employee Management System</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Analytics & Insights Dashboard</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Enterprise-Grade Security</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>24/7 Technical Support</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>No Usage Limits</span>
                                    </li>
                                    <li className={styles.featureItem}>
                                        <Check className={styles.checkIcon} />
                                        <span>Regular Feature Updates</span>
                                    </li>
                                </ul>
                            </div>

                            <div className={styles.ctaContainer}>
                                <div className={styles.buttonGroup}>
                                    <a 
                                        href="https://github.com/Deodat-Lawson/pdr_ai_v2" 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className={`${styles.btn} ${styles.btnOutline} ${styles.btnLg}`}
                                    >
                                        View on GitHub
                                    </a>
                                    <Link href="/deployment">
                                        <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`}>
                                            Deployment Guide
                                        </button>
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.benefitsSection}>
                    <div className={styles.benefitsContainer}>
                        <h2 className={styles.benefitsTitle}>Why Choose PDR AI</h2>
                        <div className={styles.benefitsGrid}>
                            <div className={styles.benefitCard}>
                                <GraduationCap className={styles.benefitIcon} />
                                <h3 className={styles.benefitTitle}>Academic Research</h3>
                                <p className={styles.benefitDescription}>
                                    Developed at Johns Hopkins University to advance AI research and provide cutting-edge document analysis tools.
                                </p>
                            </div>
                            <div className={styles.benefitCard}>
                                <Users className={styles.benefitIcon} />
                                <h3 className={styles.benefitTitle}>Open Source Freedom</h3>
                                <p className={styles.benefitDescription}>
                                    Deploy on your infrastructure with your own API keys. Full control over your data and deployment.
                                </p>
                            </div>
                            <div className={styles.benefitCard}>
                                <Brain className={styles.benefitIcon} />
                                <h3 className={styles.benefitTitle}>Free Demo Platform</h3>
                                <p className={styles.benefitDescription}>
                                    Test all features on our demo platform before deploying your own instance. No commitment required.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </ClerkProvider>
    );
} 