"use client";

import React from "react";
import { useAuth, useUser, UserButton } from "@clerk/nextjs";
import styles from "../../styles/navbar.module.css";
import { ThemeToggle } from "./ThemeToggle";
import { LaunchstackMark } from "./LaunchstackLogo";
import { LANDING_URL } from "~/config/landing";

export function SignupNavbar() {
    const { isLoaded, isSignedIn } = useAuth();
    const { user } = useUser();

    return (
        <nav className={styles.navContainer}>
            <div className={styles.navContent}>
                <div className={styles.navWrapper}>
                    {/* Cross-origin: the public site is a separate deployment. */}
                    <a href={LANDING_URL} rel="noopener" className={styles.logoContainer}>
                        <LaunchstackMark size={28} />
                        <span className={styles.logoText}>Launchstack</span>
                    </a>
                    <div className={styles.navLinks}>
                        <ThemeToggle />
                        {isLoaded && isSignedIn && user && (
                            <div className={styles.userSection}>
                                <span className={styles.userName}>
                                    {user.fullName ??
                                        user.primaryEmailAddress?.emailAddress ??
                                        user.username ??
                                        "User"}
                                </span>
                                <UserButton
                                    // A just-signed-out user is a public-site audience.
                                    afterSignOutUrl={LANDING_URL}
                                    appearance={{
                                        elements: {
                                            avatarBox: "w-8 h-8",
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
