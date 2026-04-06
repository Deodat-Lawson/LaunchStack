"use client";

import React, { useState, useEffect } from "react";
import { FileText, Brain, HelpCircle, BookOpen } from "lucide-react";
import styles from "~/styles/Employer/Home.module.css";
import { useRouter } from "next/navigation";
import ProfileDropdown from "~/app/employer/_components/ProfileDropdown";
import { useAuth } from "~/lib/auth-hooks";
import LoadingPage from "~/app/_components/loading";
import { ThemeToggle } from "~/app/_components/ThemeToggle";

const EmployeeHomeScreen = () => {
  const router = useRouter();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn || !userId) {
      console.error("[Auth Debug] isLoaded:", isLoaded, "isSignedIn:", isSignedIn, "userId:", userId);
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
      icon: <FileText className={styles.menuIcon} />,
      title: "View Documents",
      description: "Browse your company documents with AI-powered Q&A and analysis",
      path: "/employee/documents",
      isBeta: false,
    },
    {
      icon: <BookOpen className={styles.menuIcon} />,
      title: "Training Materials",
      description: "Access onboarding guides and training resources",
      path: "/employee/documents",
      isBeta: false,
    },
    {
      icon: <HelpCircle className={styles.menuIcon} />,
      title: "Contact Support",
      description: "Get help with technical difficulties and questions",
      path: "/contact",
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
            <span className={styles.logoText}>Launchstack</span>
          </div>
          <div className={styles.navActions}>
            <ThemeToggle />
            <ProfileDropdown />
          </div>
        </div>
      </nav>
      <main className={styles.main}>
        <div className={styles.welcomeSection}>
          <h1 className={styles.welcomeTitle}>Welcome to Launchstack</h1>
          <p className={styles.welcomeText}>
            Your AI integrated document management assistant and interpreter. Choose an option below
            to get started.
          </p>
        </div>

        <div className={styles.menuGrid}>
          {menuOptions.map((option, index) => (
            <div
              key={index}
              className={styles.menuCard}
              onClick={() => handleNavigation(option.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
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

export default EmployeeHomeScreen;
