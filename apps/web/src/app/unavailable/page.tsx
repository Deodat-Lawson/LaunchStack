"use client";
import React from "react";
import { AlertTriangle, ArrowLeft, Construction } from "lucide-react";
import { useTranslations } from "next-intl";
import styles from "../../styles/featureUnavailable.module.css";
import Link from "next/link";

const FeatureUnavailable = () => {
    const t = useTranslations("errors.unavailable");
    const handleGoBack = () => {
        // Navigation logic will go here
        console.log("Navigating back");
    };

    return (
        <div className={styles.container}>
            <div className={styles.content}>
                <div className={styles.iconContainer}>
                    <Construction className={styles.icon} />
                </div>

                <h1 className={styles.title}>{t("title")}</h1>

                <p className={styles.description}>{t("body")}</p>

                <div className={styles.messageBox}>
                    <AlertTriangle className={styles.alertIcon} />
                    <p className={styles.message}>{t("expected")}</p>
                </div>

                <div className={styles.alternativesBox}>
                    <h2 className={styles.alternativesTitle}>{t("meanwhile")}</h2>
                    <ul className={styles.alternativesList}>
                        <li>{t("explore")}</li>
                        <li>{t("docs")}</li>
                        <li>{t("contact")}</li>
                    </ul>
                </div>

                <Link href="/">
                    <button onClick={handleGoBack} className={styles.backButton}>
                        <ArrowLeft className={styles.backIcon} />
                        {t("backHome")}
                    </button>
                </Link>
            </div>
        </div>
    );
};

export default FeatureUnavailable;
