"use client";

import React, { useEffect, useState } from "react";
import { useAuth, useUser } from "~/lib/auth-hooks";
import { useRouter } from "next/navigation";
import { Brain, Home } from "lucide-react";

// Child Components
import SettingsForm from "~/app/employer/settings/SettingsForm";
import PopupModal from "~/app/employer/settings/PopupModal";
import { ThemeToggle } from "~/app/_components/ThemeToggle";

// Loading component
import LoadingPage from "~/app/_components/loading";

// Styles
import styles from "~/styles/Employer/Settings.module.css";

interface Company {
    id: number;
    name: string;
    numberOfEmployees: string;
    createdAt: string;
    updatedAt: string;
}


const SettingsPage = () => {
    const router = useRouter();

    // Clerk Auth
    const { isLoaded, isSignedIn, userId } = useAuth();
    const { user } = useUser();

    // --------------------------------------------------------------------------
    // Page & Form States
    // --------------------------------------------------------------------------
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Existing fields (from Clerk user)
    const [displayName, setDisplayName] = useState(user?.fullName ?? "");
    const [email, setEmail] = useState(user?.emailAddresses[0]?.emailAddress ?? "");

    // New fields
    const [companyName, setCompanyName] = useState("");
    const [staffCount, setStaffCount] = useState("");

    // --------------------------------------------------------------------------
    // Popup (Modal) Management
    // --------------------------------------------------------------------------
    const [popupVisible, setPopupVisible] = useState(false);
    const [popupMessage, setPopupMessage] = useState("");
    const [redirectPath, setRedirectPath] = useState("");

    // A helper to show a popup without redirect
    const showPopup = (message: string) => {
        setPopupMessage(message);
        setRedirectPath("");
        setPopupVisible(true);
    };

    // A helper to show a popup *and* redirect after closing
    const showPopupAndRedirect = (message: string, path: string) => {
        setPopupMessage(message);
        setRedirectPath(path);
        setPopupVisible(true);
    };

    // Called when user clicks "OK" on the popup
    const handlePopupClose = () => {
        setPopupVisible(false);
        if (redirectPath) {
            router.push(redirectPath);
        }
    };

    // --------------------------------------------------------------------------
    // Fetch & Validate on Mount
    // --------------------------------------------------------------------------
    useEffect(() => {
        if (!isLoaded) return;

        // Use isSignedIn for reliable auth check
        if (!isSignedIn || !userId) {
            console.error("[Auth Debug] isLoaded:", isLoaded, "isSignedIn:", isSignedIn, "userId:", userId);
            router.push("/");
            return;
        }

        const checkEmployerAndFetchCompany = async () => {
            try {
                // Fetch company info after middleware-authenticated navigation.
                const companyResponse = await fetch("/api/fetchCompany", {
                    method: "GET",
                });

                if (!companyResponse.ok) {
                    throw new Error("Failed to fetch company info");
                }

                const rawData: unknown = await companyResponse.json();
                if (typeof rawData !== "object") {
                    throw new Error("Invalid response from server");
                }

                const data = rawData as Company;

                setCompanyName(data.name ?? "");
                setStaffCount(data.numberOfEmployees ?? "");

                setDisplayName(user?.fullName ?? "");
                setEmail(user?.emailAddresses[0]?.emailAddress ?? "");
            } catch (error) {
                console.error("Error:", error);
                showPopupAndRedirect("Something went wrong. Redirecting you home.", "/");
            } finally {
                setLoading(false);
            }
        };

        void checkEmployerAndFetchCompany();
    }, [isLoaded, isSignedIn, userId, user, router]);

    // --------------------------------------------------------------------------
    // Save Handler
    // --------------------------------------------------------------------------
    const handleSave = async () => {
        setIsSaving(true);
        try {
            const response = await fetch("/api/updateCompany", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: companyName,
                    numberOfEmployees: staffCount,
                }),
            });

            const result: { success?: boolean; message?: string } | null = await response
                .json()
                .catch(() => null) as { success?: boolean; message?: string } | null;

            if (!response.ok || result?.success !== true) {
                throw new Error(result?.message ?? "Error updating settings");
            }

            showPopup(result?.message ?? "Company settings saved!");
        } catch (error) {
            console.error(error);
            showPopup(error instanceof Error ? error.message : "Failed to update settings. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    // --------------------------------------------------------------------------
    // Render
    // --------------------------------------------------------------------------
    if (loading) {
        return <LoadingPage />;
    }

    return (
        <div className={styles.container}>
            {/* Navbar */}
            <nav className={styles.navbar}>
                <div className={styles.navContent}>
                    <div className={styles.logoWrapper}>
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
                            <Home className={styles.iconButtonIcon} />
                        </button>
                    </div>
                </div>
            </nav>

            {/* Child Form Component */}
            <SettingsForm
                displayName={displayName}
                email={email}
                companyName={companyName}
                staffCount={staffCount}
                isSaving={isSaving}
                onCompanyNameChange={setCompanyName}
                onStaffCountChange={setStaffCount}
                onSave={handleSave}
            />

            {/* Child Popup Component */}
            <PopupModal
                visible={popupVisible}
                message={popupMessage}
                onClose={handlePopupClose}
            />
        </div>
    );
};

export default SettingsPage;
