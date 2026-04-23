"use client";

import React from "react";
import styles from "~/styles/Employee/PendingApproval.module.css";
import ProfileDropdown from "~/app/employer/_components/ProfileDropdown";
import { LaunchstackMark } from "~/app/_components/LaunchstackLogo";

const NavBar = () => {
    return (
        <nav className={styles.navbar}>
            <div className={styles.navContent}>
                <div className={styles.logoContainer}>
                    <LaunchstackMark size={26} title="Launchstack" />
                    <span className={styles.logoText}>Launchstack</span>
                </div>
                <ProfileDropdown />
            </div>
        </nav>
    );
};

export default NavBar;