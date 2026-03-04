"use client";
import React, { useState, useEffect } from "react";
import { Upload, FileText, BarChart, Brain, Settings, Users, HelpCircle, Clock, MousePointerClick, Megaphone, Building2 } from "lucide-react";
import styles from "~/styles/Employer/Home.module.css";
import { useRouter } from "next/navigation";
import ProfileDropdown from "~/app/employer/_components/ProfileDropdown";
import { useAuth } from "@clerk/nextjs";
import LoadingPage from "~/app/_components/loading";
import { ThemeToggle } from "~/app/_components/ThemeToggle";

interface DashboardStats {
    totalEmployees: number;
    totalDocuments: number;
    activeUsers: number;
    thirtyDayViews: number;
}

import type { TrendDataPoint, EmployeeInfo, DocumentStat } from "../../employer/statistics/types";

interface AnalysisDashboardData {
    totalEmployees: number;
    totalDocuments: number;
    employees: EmployeeInfo[];
    employeeTrend: TrendDataPoint[];
    documentViewsTrend: TrendDataPoint[];
    documentStats: DocumentStat[];
}

interface AnalysisDashboardResponse {
    success: boolean;
    data?: AnalysisDashboardData;
    error?: string;
}

const HomeScreen = () => {
    const router = useRouter();

    // check if authorized. If not authorized as employer, return home
    const { isLoaded, isSignedIn, userId } = useAuth();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<DashboardStats | null>(null);

    useEffect(() => {
        if (!isLoaded) return;
        // Use isSignedIn for reliable auth check
        if (!isSignedIn || !userId) {
            console.error("[Auth Debug] isLoaded:", isLoaded, "isSignedIn:", isSignedIn, "userId:", userId);
            router.push("/");
            return;
        }

        // Check if the user's role is employer and fetch stats
        const initDashboard = async () => {
            try {
                // Fetch stats after middleware-authenticated navigation.
                const statsResponse = await fetch("/api/company/analysis-dashboard");
                if (!statsResponse.ok) {
                    router.push("/");
                    return;
                }
                const statsResult = (await statsResponse.json()) as AnalysisDashboardResponse;
                
                if (statsResult.success && statsResult.data) {
                    const data = statsResult.data;
                    
                    // Calculate active users based on lastActiveAt within 30 days
                    const thirtyDaysAgo = new Date();
                    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                    
                    const activeUsersCount = data.employees.filter((e) => {
                        if (!e.lastActiveAt) return false;
                        return new Date(e.lastActiveAt) >= thirtyDaysAgo;
                    }).length;

                    setStats({
                        totalEmployees: data.totalEmployees,
                        totalDocuments: data.totalDocuments,
                        activeUsers: activeUsersCount,
                        thirtyDayViews: data.documentViewsTrend.reduce((sum, d) => sum + d.count, 0)
                    });
                }
            } catch (error) {
                console.error("Error initializing dashboard:", error);
            } finally {
                setLoading(false);
            }
        };

        initDashboard().catch(console.error);
    }, [userId, router, isLoaded, isSignedIn]);

    // Updated menu options with Manage Employees
    const menuOptions = [
        {
            icon: <Upload className={styles.menuIcon} />,
            title: "Upload Documents",
            description: "Add new documents to the database for AI analysis",
            path: "/employer/upload",
            isBeta: false,
        },
        {
            icon: <FileText className={styles.menuIcon} />,
            title: "View Documents",
            description: `Browse and manage your ${stats ? stats.totalDocuments : 'uploaded'} documents`,
            path: "/employer/documents",
            isBeta: false,
        },
        {
            icon: <BarChart className={styles.menuIcon} />,
            title: "Document Statistics",
            description: "View analytics and insights about document usage",
            path: "/employer/statistics",
            isBeta: false,
        },
        {
            icon: <Building2 className={styles.menuIcon} />,
            title: "Company Metadata",
            description: "View AI-extracted company info from your documents",
            path: "/employer/metadata",
            isBeta: false,
        },
        {
            icon: <Users className={styles.menuIcon} />,
            title: "Manage Employees",
            description: `View and manage ${stats ? stats.totalEmployees : ''} employees in your organization`,
            path: "/employer/employees",
            isBeta: false,
        },
        {
            icon: <Megaphone className={styles.menuIcon} />,
            title: "Marketing Pipeline",
            description: "Research trends and generate campaign-ready platform messages",
            path: "/employer/tools/marketing-pipeline",
            isBeta: false,
        },
        {
            icon: <Settings className={styles.menuIcon} />,
            title: "User Settings",
            description: "Manage your profile, preferences, and account details",
            path: "/employer/settings",
            isBeta: false,
        },
        {
            icon: <HelpCircle className={styles.menuIcon} />,
            title: "Contact Support",
            description: "Get help with technical difficulties and questions",
            path: "/employer/contact",
            isBeta: false,
        },
    ];

    const handleNavigation = (path: string) => {
        router.push(path);
    };

    if (loading) {
        return <LoadingPage />;
    }

    return (
        <div className={styles.container}>
            <nav className={styles.navbar}>
                <div className={styles.navContent}>
                    <div className={styles.logoContainer}>
                        <Brain className={styles.logoIcon} />
                        <span className={styles.logoText}>PDR AI</span>
                    </div>
                    <div className={styles.navActions}>
                        <ThemeToggle />
                        <ProfileDropdown />
                    </div>
                </div>
            </nav>
            <main className={styles.main}>
                <div className={styles.welcomeSection}>
                    <h1 className={styles.welcomeTitle}>Welcome to PDR AI</h1>
                    <p className={styles.welcomeText}>
                        Your AI integrated document management assistant and interpreter. Choose an option below
                        to get started.
                    </p>
                </div>

                {/* Stats Cards */}
                {stats && (
                    <div className={styles.statsGrid}>
                        <div className={styles.statsCard} style={{ borderLeftColor: '#9333ea' }}>
                            <div className={styles.statsHeader}>
                                <span className={styles.statsLabel}>Total Employees</span>
                                <Users className={styles.statsIcon} style={{ color: '#9333ea' }} />
                            </div>
                            <div className={styles.statsValue}>{stats.totalEmployees}</div>
                        </div>
                        <div className={styles.statsCard} style={{ borderLeftColor: '#3b82f6' }}>
                            <div className={styles.statsHeader}>
                                <span className={styles.statsLabel}>Total Documents</span>
                                <FileText className={styles.statsIcon} style={{ color: '#3b82f6' }} />
                            </div>
                            <div className={styles.statsValue}>{stats.totalDocuments}</div>
                        </div>
                        <div className={styles.statsCard} style={{ borderLeftColor: '#22c55e' }}>
                            <div className={styles.statsHeader}>
                                <span className={styles.statsLabel}>Active Users</span>
                                <Clock className={styles.statsIcon} style={{ color: '#22c55e' }} />
                            </div>
                            <div className={styles.statsValue}>{stats.activeUsers}</div>
                        </div>
                        <div className={styles.statsCard} style={{ borderLeftColor: '#f59e0b' }}>
                            <div className={styles.statsHeader}>
                                <span className={styles.statsLabel}>30 Days Views</span>
                                <MousePointerClick className={styles.statsIcon} style={{ color: '#f59e0b' }} />
                            </div>
                            <div className={styles.statsValue}>{stats.thirtyDayViews}</div>
                        </div>
                    </div>
                )}

                <div className={styles.menuGrid}>
                    {menuOptions.map((option, index) => (
                        <div
                            key={index}
                            className={styles.menuCard}
                            onClick={() => handleNavigation(option.path)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleNavigation(option.path);
                                }
                            }}
                            role="button"
                            tabIndex={0}
                        >
                            <div className={styles.cardHeader}>
                                <div className={styles.iconContainer}>{option.icon}</div>
                                {option.isBeta && (
                                    <span className={styles.betaBadge}>Beta</span>
                                )}
                            </div>
                            <h2 className={styles.menuTitle}>{option.title}</h2>
                            <p className={styles.menuDescription}>{option.description}</p>
                            <div className={styles.cardFooter}>
                                <span className={styles.getStarted}>Get Started</span>
                            </div>
                        </div>
                    ))}
                </div>
            </main>
        </div>
    );
};

export default HomeScreen;
