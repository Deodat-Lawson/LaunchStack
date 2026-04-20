"use client";

import React from "react";
import {Brain, Home} from "lucide-react";
import styles from "~/styles/Employer/EmployeeManagement.module.css";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "~/app/_components/ThemeToggle";

const NavBar = () => {
    const router = useRouter();
    return (
        <nav className={styles.navbar}>
            <div className={styles.navContent}>
                <div className={styles.logoContainer}>
                    <Brain className={styles.logoIcon} />
                    <span className={styles.logoText}>Launchstack</span>
                </div>
                <div className={styles.navActions}>
                    <ThemeToggle />
                    <button
                        onClick={() => router.push("/employer/home")}
                        className={styles.iconButton}
                        aria-label="Go to home"
                    >
                        <Home className={styles.iconButtonIcon}/>
                    </button>
                </div>
            </div>
        </nav>
    );
};

export default NavBar;
