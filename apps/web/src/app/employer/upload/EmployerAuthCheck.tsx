"use client";

import React, { useState, useEffect, type PropsWithChildren } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import LoadingPage from "~/app/_components/loading";

interface EmployerAuthCheckProps {
    onAuthSuccess: (userId: string) => void;
}

const EmployerAuthCheck: React.FC<PropsWithChildren<EmployerAuthCheckProps>> = ({
                                                                                    onAuthSuccess,
                                                                                    children,
                                                                                }) => {
    const { isLoaded, isSignedIn, userId } = useAuth();
    const router = useRouter();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isLoaded) return;

        // Use isSignedIn for reliable auth check
        if (!isSignedIn || !userId) {
            console.error("[Auth Debug] isLoaded:", isLoaded, "isSignedIn:", isSignedIn, "userId:", userId);
            router.push("/");
            return;
        }

        const checkEmployerRole = async () => {
            try {
                // Middleware already enforces role and status for /employer routes.
                onAuthSuccess(userId);
            } catch (error) {
                console.error("Error checking employer role:", error);
                alert("Authentication failed! You are not an employer.");
                router.push("/");
            } finally {
                setLoading(false);
            }
        };

        checkEmployerRole().catch(console.error);
    }, [isLoaded, isSignedIn, userId, router, onAuthSuccess]);

    if (loading) {
        return <LoadingPage />;
    }

    return <>{children}</>;
};

export default EmployerAuthCheck;
