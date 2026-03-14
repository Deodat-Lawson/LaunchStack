'use client';

import Link from "next/link";
import React from 'react';
import { Brain } from 'lucide-react';
import styles from '../../styles/navbar.module.css';
import { ThemeToggle } from './ThemeToggle';

export function Navbar() {
    return (
        <nav className={styles.navContainer}>
            <div className={styles.navContent}>
                <div className={styles.navWrapper}>
                    <Link href="/" className={styles.logoContainer}>
                        <Brain className={styles.iconPurple} />
                        <span className={styles.logoText}>Launchstack</span>
                    </Link>
                    <div className={styles.navLinks}>
                        <Link href="/">
                            <button className={`${styles.btn} ${styles.btnGhost}`}>
                                Home
                            </button>
                        </Link>
                        <Link href="/pricing">
                            <button className={`${styles.btn} ${styles.btnGhost}`}>
                                Pricing
                            </button>
                        </Link>
                        <Link href="/deployment">
                            <button className={`${styles.btn} ${styles.btnGhost}`}>
                                Deployment
                            </button>
                        </Link>
                        <Link href="/contact">
                            <button className={`${styles.btn} ${styles.btnGhost}`}>
                                Contact
                            </button>
                        </Link>
                        <ThemeToggle />
                        <Link href="/signin">
                            <button className={`${styles.btn} ${styles.btnSecondary}`}>
                                Sign In
                            </button>
                        </Link>
                        <Link href="/signup">
                            <button className={`${styles.btn} ${styles.btnPrimary}`}>
                                Get Started
                            </button>
                        </Link>
                    </div>
                </div>
            </div>
        </nav>
    );
}

