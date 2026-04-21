"use client";

import { MarketingPipelineWorkspace } from "~/app/employer/documents/components/marketing-pipeline/MarketingPipelineWorkspace";
import styles from "~/styles/Employer/MarketingPipeline.module.css";

export function MarketingPipelinePanel() {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className={styles.main}>
        <MarketingPipelineWorkspace />
      </div>
    </div>
  );
}
