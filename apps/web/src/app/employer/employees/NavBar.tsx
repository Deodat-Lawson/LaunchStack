"use client";

import React from "react";
import { Home } from "lucide-react";
import styles from "~/styles/Employer/EmployeeManagement.module.css";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "~/app/_components/ThemeToggle";
import { LaunchstackMark } from "~/app/_components/LaunchstackLogo";

const NavBar = () => {
    const router = useRouter();
    return (
        <nav className={styles.navbar}>
            <div className={styles.navContent}>
                <div className={styles.logoContainer}>
                    <LaunchstackMark size={26} title="Launchstack" />
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
