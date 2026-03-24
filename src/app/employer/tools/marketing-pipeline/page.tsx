"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Brain } from "lucide-react";
import ProfileDropdown from "~/app/employer/_components/ProfileDropdown";
import { ThemeToggle } from "~/app/_components/ThemeToggle";
import { MarketingPipelineWorkspace } from "~/app/employer/documents/components/marketing-pipeline/MarketingPipelineWorkspace";
import homeStyles from "~/styles/Employer/Home.module.css";
import styles from "~/styles/Employer/MarketingPipeline.module.css";

export default function MarketingPipelinePage() {
  return (
    <Suspense>
      <MarketingPipelineContent />
    </Suspense>
  );
}

function MarketingPipelineContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDebug = searchParams.get("debug") === "true";

  return (
    <div className={homeStyles.container}>
      <nav className={homeStyles.navbar}>
        <div className={homeStyles.navContent}>
          <div
            className={homeStyles.logoContainer}
            onClick={() => router.push("/employer/home")}
            onKeyDown={(e) => e.key === "Enter" && router.push("/employer/home")}
            role="button"
            tabIndex={0}
          >
            <Brain className={homeStyles.logoIcon} />
            <span className={homeStyles.logoText}>Launchstack</span>
          </div>
          <div className={homeStyles.navActions}>
            <button
              type="button"
              className={styles.backNavButton}
              onClick={() => router.push("/employer/home")}
            >
              <ArrowLeft className="w-4 h-4" />
              Home
            </button>
            <ThemeToggle />
            <ProfileDropdown />
          </div>
        </div>
      </nav>

      <main className={styles.main}>
        <MarketingPipelineWorkspace debug={isDebug} showDnaDebugSection={isDebug} />
      </main>
    </div>
  );
}
