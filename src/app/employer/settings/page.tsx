"use client";

import React, { useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
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

interface RedactedKey {
    hasKey: boolean;
    last4: string | null;
}

interface Company {
    id: number;
    name: string;
    embeddingIndexKey: string | null;
    embeddingOpenAIApiKey: RedactedKey;
    embeddingHuggingFaceApiKey: RedactedKey;
    embeddingOllamaBaseUrl: string | null;
    embeddingOllamaModel: string | null;
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
    const [embeddingIndexKey, setEmbeddingIndexKey] = useState("legacy-openai-1536");
    const [embeddingOpenAIApiKey, setEmbeddingOpenAIApiKey] = useState("");
    const [embeddingHuggingFaceApiKey, setEmbeddingHuggingFaceApiKey] = useState("");
    const [embeddingOllamaBaseUrl, setEmbeddingOllamaBaseUrl] = useState("");
    const [embeddingOllamaModel, setEmbeddingOllamaModel] = useState("");

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
                setEmbeddingIndexKey(data.embeddingIndexKey ?? "legacy-openai-1536");
                // API keys are never returned from the server; leave inputs
                // blank and treat blank-on-save as "keep existing key".
                setEmbeddingOpenAIApiKey("");
                setEmbeddingHuggingFaceApiKey("");
                setEmbeddingOllamaBaseUrl(data.embeddingOllamaBaseUrl ?? "");
                setEmbeddingOllamaModel(data.embeddingOllamaModel ?? "");

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
            const body: Record<string, unknown> = {
                name: companyName,
                numberOfEmployees: staffCount,
                embeddingIndexKey,
                embeddingOllamaBaseUrl: embeddingOllamaBaseUrl || null,
                embeddingOllamaModel: embeddingOllamaModel || null,
            };
            // Only include API keys when the user typed something. Blank
            // means "keep whatever is already stored on the server".
            if (embeddingOpenAIApiKey.trim().length > 0) {
                body.embeddingOpenAIApiKey = embeddingOpenAIApiKey.trim();
            }
            if (embeddingHuggingFaceApiKey.trim().length > 0) {
                body.embeddingHuggingFaceApiKey = embeddingHuggingFaceApiKey.trim();
            }

            const response = await fetch("/api/updateCompany", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const result = (await response
                .json()
                .catch(() => null)) as {
                success?: boolean;
                message?: string;
                code?: string;
                documentCount?: number;
            } | null;

            if (response.status === 409 && result?.code === "REINDEX_IN_PROGRESS") {
                throw new Error(
                    result.message ??
                        "A reindex is already running for this company. Please wait for it to finish.",
                );
            }

            if (!response.ok || result?.success !== true) {
                throw new Error(result?.message ?? "Error updating settings");
            }

            if (response.status === 202 && result?.code === "REINDEX_SCHEDULED") {
                showPopup(
                    result.message ??
                        `Reindex scheduled for ${result.documentCount ?? 0} document chunks. Existing searches keep using the previous index until the rewrite completes.`,
                );
                return;
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
                embeddingIndexKey={embeddingIndexKey}
                embeddingOpenAIApiKey={embeddingOpenAIApiKey}
                embeddingHuggingFaceApiKey={embeddingHuggingFaceApiKey}
                embeddingOllamaBaseUrl={embeddingOllamaBaseUrl}
                embeddingOllamaModel={embeddingOllamaModel}
                isSaving={isSaving}
                onCompanyNameChange={setCompanyName}
                onStaffCountChange={setStaffCount}
                onEmbeddingIndexKeyChange={setEmbeddingIndexKey}
                onEmbeddingOpenAIApiKeyChange={setEmbeddingOpenAIApiKey}
                onEmbeddingHuggingFaceApiKeyChange={setEmbeddingHuggingFaceApiKey}
                onEmbeddingOllamaBaseUrlChange={setEmbeddingOllamaBaseUrl}
                onEmbeddingOllamaModelChange={setEmbeddingOllamaModel}
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
