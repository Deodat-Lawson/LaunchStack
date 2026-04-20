"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { Brain, Home, ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import EmployerAuthCheck from "./EmployerAuthCheck";
import UploadForm, { type AvailableProviders } from "./UploadForm";
import ProfileDropdown from "~/app/employer/_components/ProfileDropdown";
import { Toaster } from "~/app/employer/documents/components/ui/sonner";
import styles from "~/styles/Employer/Upload.module.css";

const CategoryManagement = dynamic(() => import("./CategoryManagement"), {
    ssr: false,
});

const ThemeToggle = dynamic(
    () =>
        import("~/app/_components/ThemeToggle").then(
            (module) => module.ThemeToggle
        ),
    { ssr: false }
);

interface Category {
    id: string;
    name: string;
}

type CategoryResponse = {
    id: number;
    success: boolean;
    name: string;
}

interface CompanyData {
    id: number;
    name: string;
    useUploadThing: boolean;
}

interface UploadBootstrapResponse {
    categories: Category[];
    company: CompanyData | null;
    isUploadThingConfigured: boolean;
    availableProviders: AvailableProviders;
    storageProvider: "s3" | "database";
    s3Endpoint: string;
}

const Page: React.FC = () => {
    const router = useRouter();

    const [categories, setCategories] = useState<Category[]>([]);
    const [useUploadThing, setUseUploadThing] = useState<boolean>(true);
    const [isUploadThingConfigured, setIsUploadThingConfigured] = useState<boolean>(false);
    const [isUpdatingPreference, setIsUpdatingPreference] = useState(false);
    const [availableProviders, setAvailableProviders] = useState<AvailableProviders>({
        azure: false,
        datalab: false,
        landingAI: false,
        docling: false,
    });
    const [storageProvider, setStorageProvider] = useState<"s3" | "database">("s3");
    const [s3Endpoint, setS3Endpoint] = useState("");

    const fetchUploadBootstrap = useCallback(async () => {
        try {
            const res = await fetch("/api/employer/upload/bootstrap", {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            });

            if (!res.ok) {
                throw new Error("Failed to fetch upload bootstrap data");
            }

            const data = (await res.json()) as UploadBootstrapResponse;
            setCategories(data.categories);
            setIsUploadThingConfigured(data.isUploadThingConfigured);
            setAvailableProviders(data.availableProviders);
            setStorageProvider(data.storageProvider);
            setS3Endpoint(data.s3Endpoint);

            if (!data.isUploadThingConfigured) {
                setUseUploadThing(false);
                return;
            }

            const companyUploadPref = data.company?.useUploadThing;
            setUseUploadThing(companyUploadPref ?? true);
        } catch (error) {
            console.error("Error fetching upload bootstrap data:", error);
        }
    }, []);

    const handleAuthSuccess = useCallback(async () => {
        await fetchUploadBootstrap();
    }, [fetchUploadBootstrap]);

    const handleToggleUploadMethod = useCallback(async (newValue: boolean) => {
        setIsUpdatingPreference(true);
        try {
            const res = await fetch("/api/updateUploadPreference", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ useUploadThing: newValue }),
            });

            if (res.ok) {
                const data = await res.json() as { success: boolean; useUploadThing: boolean };
                if (data.success) {
                    setUseUploadThing(data.useUploadThing);
                }
            } else {
                console.error("Failed to update upload preference");
            }
        } catch (error) {
            console.error("Error updating upload preference:", error);
        } finally {
            setIsUpdatingPreference(false);
        }
    }, []);

    const handleAddCategory = useCallback(
        async (newCategory: string) => {
            if (!newCategory.trim()) return;
            try {
                const res = await fetch("/api/Categories/AddCategories", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ CategoryName: newCategory }),
                });
                if (!res.ok) {
                    throw new Error("Failed to create category");
                }
                const rawData = await res.json() as CategoryResponse;
                
                if (rawData.success) {
                    const createdCategory = { id: rawData.id, name: rawData.name };
                    setCategories((prev) => {
                        const newCategories = [...prev, { id: createdCategory.id.toString(), name: createdCategory.name }];
                        return newCategories;
                    });
                    toast.success(`Category "${rawData.name}" created`);
                } else {
                    console.error("Invalid category data received:", rawData);
                    toast.error("Invalid category data format");
                }
            } catch (error) {
                console.error(error);
                toast.error("Error creating category. Check console for details.");
            }
        },
        [],
    );

    const handleRemoveCategory = useCallback(async (id: string, categoryName: string) => {
        try {
            const res = await fetch("/api/Categories/DeleteCategories", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            if (!res.ok) {
                throw new Error("Failed to remove category");
            }
            setCategories((prev) => prev.filter((cat) => cat.id !== id));
            toast.success(`Category "${categoryName}" removed`);
        } catch (error) {
            console.error(error);
            toast.error("Error removing category. Check console for details.");
        }
    }, []);

    return (
        <EmployerAuthCheck onAuthSuccess={handleAuthSuccess}>
            <div className={styles.mainContainer}>
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
                            <div className={styles.navProfile}>
                                <ProfileDropdown />
                            </div>
                        </div>
                    </div>
                </nav>

                <div className={styles.container}>
                {/* Breadcrumb */}
                <nav className={styles.breadcrumb} aria-label="Breadcrumb">
                    <ol className={styles.breadcrumbList}>
                        <li className={styles.breadcrumbItem}>
                            <Link href="/employer/home" className={styles.breadcrumbLink}>
                                Home
                            </Link>
                        </li>
                        <li className={styles.breadcrumbItem}>
                            <ChevronRight className={styles.breadcrumbSeparator} aria-hidden />
                            <span className={styles.breadcrumbCurrent} aria-current="page">
                                Upload
                            </span>
                        </li>
                    </ol>
                </nav>

                <div className={styles.header}>
                    <h1 className={styles.title}>Add Knowledge</h1>
                    <p className={styles.subtitle}>
                        Index anything into your knowledge base — files, GitHub repos, pasted text, and more.
                    </p>
                </div>

                <UploadForm 
                    categories={categories}
                    useUploadThing={useUploadThing}
                    isUploadThingConfigured={isUploadThingConfigured}
                    onToggleUploadMethod={handleToggleUploadMethod}
                    isUpdatingPreference={isUpdatingPreference}
                    availableProviders={availableProviders}
                    onAddCategory={handleAddCategory}
                    storageProvider={storageProvider}
                    s3Endpoint={s3Endpoint}
                />

                <CategoryManagement
                    categories={categories}
                    onAddCategory={handleAddCategory}
                    onRemoveCategory={handleRemoveCategory}
                />
                </div>
                <Toaster />
            </div>
        </EmployerAuthCheck>
    );
};

export default Page;
