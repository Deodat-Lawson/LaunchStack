"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MarketingPipelineWorkspace } from "~/app/employer/documents/components/marketing-pipeline/MarketingPipelineWorkspace";
import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";
import styles from "~/styles/Employer/MarketingPipeline.module.css";

export default function MarketingPipelinePage() {
  return (
    <Suspense>
      <MarketingPipelineContent />
    </Suspense>
  );
}

function MarketingPipelineContent() {
  const searchParams = useSearchParams();
  const isDebug = searchParams.get("debug") === "true";

  return (
    <ToolsStudioShell>
      <main className={styles.main}>
        <MarketingPipelineWorkspace debug={isDebug} showDnaDebugSection={isDebug} />
      </main>
    </ToolsStudioShell>
  );
}
