"use client"
import React from 'react';
import { AlertTriangle, ArrowLeft, Construction } from 'lucide-react';
import styles from '../../styles/featureUnavailable.module.css';
import Link from "next/link";

const FeatureUnavailable = () => {
    const handleGoBack = () => {
        // Navigation logic will go here
        console.log('Navigating back');
    };

    return (
        <div className={styles.container}>
            <div className={styles.content}>
                <div className={styles.iconContainer}>
                    <Construction className={styles.icon} />
                </div>

                <h1 className={styles.title}>
                    Feature Currently Unavailable
                </h1>

                <p className={styles.description}>
                    We are working hard to bring this feature to you. Please check back soon!
                </p>

                <div className={styles.messageBox}>
                    <AlertTriangle className={styles.alertIcon} />
                    <p className={styles.message}>
                        Expected availability: Q4 2025 ~ Q1 2026
                    </p>
                </div>

                <div className={styles.alternativesBox}>
                    <h2 className={styles.alternativesTitle}>In the meantime, you can:</h2>
                    <ul className={styles.alternativesList}>
                        <li>Explore our available features</li>
                        <li>Check our documentation for updates</li>
                        <li>Contact support for more information</li>
                    </ul>
                </div>

                <Link href="/">
                    <button
                        onClick={handleGoBack}
                        className={styles.backButton}
                    >
                        <ArrowLeft className={styles.backIcon} />
                        Back to Home
                    </button>
                </Link>

            </div>
        </div>
    );
};

export default FeatureUnavailable;
