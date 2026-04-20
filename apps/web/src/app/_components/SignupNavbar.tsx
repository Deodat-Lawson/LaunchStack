'use client';

import Link from "next/link";
import React from 'react';
import { Brain } from 'lucide-react';
import { useAuth, useUser, UserButton } from '@clerk/nextjs';
import styles from '../../styles/navbar.module.css';
import { ThemeToggle } from './ThemeToggle';

export function SignupNavbar() {
    const { isLoaded, isSignedIn } = useAuth();
    const { user } = useUser();

    return (
        <nav className={styles.navContainer}>
            <div className={styles.navContent}>
                <div className={styles.navWrapper}>
                    <Link href="/" className={styles.logoContainer}>
                        <Brain className={styles.iconPurple} />
                        <span className={styles.logoText}>Launchstack</span>
                    </Link>
                    <div className={styles.navLinks}>
                        <ThemeToggle />
                        {isLoaded && isSignedIn && user && (
                            <div className={styles.userSection}>
                                <span className={styles.userName}>
                                    {user.fullName ?? user.primaryEmailAddress?.emailAddress ?? user.username ?? 'User'}
                                </span>
                                <UserButton
                                    afterSignOutUrl="/"
                                    appearance={{
                                        elements: {
                                            avatarBox: 'w-8 h-8',
                                        },
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </nav>
    );
}

