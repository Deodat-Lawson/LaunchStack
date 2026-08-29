"use client";

import React, { useState, useEffect } from "react";
import { FileText, HelpCircle, BookOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "~/lib/auth-client";
import { LANDING_CONTACT_URL } from "~/config/landing";
import LoadingPage from "~/app/_components/loading";
import { EmployeeNavbar } from "~/app/employee/_components/employee-navbar";

const EmployeeHomeScreen = () => {
    const router = useRouter();
    const { isLoaded, isSignedIn, userId } = useAuth();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isLoaded) return;

        if (!isSignedIn || !userId) {
            console.error(
                "[Auth Debug] isLoaded:",
                isLoaded,
                "isSignedIn:",
                isSignedIn,
                "userId:",
                userId
            );
            router.push("/");
            return;
        }

        const checkEmployeeRole = async () => {
            try {
                const response = await fetch("/api/employeeAuth", {
                    method: "GET",
                });

                if (response.status === 300) {
                    router.push("/employee/pending-approval");
                    return;
                } else if (!response.ok) {
                    window.alert("Authentication failed! You are not an employee.");
                    router.push("/");
                    return;
                }
            } catch (error) {
                console.error("Error checking employee role:", error);
                window.alert("Authentication failed! You are not an employee.");
                router.push("/");
            } finally {
                setLoading(false);
            }
        };

        checkEmployeeRole().catch(console.error);
    }, [isLoaded, isSignedIn, userId, router]);

    const menuOptions = [
        {
            icon: FileText,
            title: "View Documents",
            description: "Browse your company documents with AI-powered Q&A and analysis",
            path: "/employee/documents",
        },
        {
            icon: BookOpen,
            title: "Training Materials",
            description: "Access onboarding guides and training resources",
            path: "/employee/documents",
        },
        {
            icon: HelpCircle,
            title: "Contact Support",
            description: "Get help with technical difficulties and questions",
            path: LANDING_CONTACT_URL,
        },
    ];

    const handleNavigation = (path: string) => {
        // "Contact Support" points at the public site, which is a different
        // origin. next/navigation's router only handles in-app routes, so absolute
        // URLs need a real document navigation.
        if (/^https?:\/\//.test(path)) {
            window.location.href = path;
            return;
        }
        router.push(path);
    };

    if (loading) {
        return <LoadingPage />;
    }

    return (
        <div className="bg-surface text-ink min-h-screen">
            <EmployeeNavbar />
            <main className="mx-auto max-w-5xl px-6 py-12">
                <div className="mb-10">
                    <h1 className="text-3xl font-bold tracking-tight">Welcome to Launchstack</h1>
                    <p className="text-ink-2 mt-2 max-w-2xl">
                        Your AI integrated document management assistant and interpreter. Choose an
                        option below to get started.
                    </p>
                </div>

                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {menuOptions.map(option => (
                        <div
                            key={option.title}
                            className="border-line bg-panel shadow-1 hover:border-brand hover:shadow-2 cursor-pointer rounded-lg border p-6 transition-all"
                            onClick={() => handleNavigation(option.path)}
                            onKeyDown={e => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    handleNavigation(option.path);
                                }
                            }}
                            role="button"
                            tabIndex={0}
                        >
                            <div className="bg-brand-soft mb-4 flex h-11 w-11 items-center justify-center rounded-md">
                                <option.icon className="text-brand-ink h-5 w-5" />
                            </div>
                            <h2 className="text-base font-semibold">{option.title}</h2>
                            <p className="text-ink-2 mt-1 text-sm leading-relaxed">
                                {option.description}
                            </p>
                            <div className="text-brand-ink mt-4 text-sm font-medium">
                                Get Started
                            </div>
                        </div>
                    ))}
                </div>
            </main>
        </div>
    );
};

export default EmployeeHomeScreen;
