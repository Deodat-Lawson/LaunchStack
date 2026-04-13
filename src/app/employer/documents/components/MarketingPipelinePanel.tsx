"use client";

import { MarketingPipelineWorkspace } from "~/app/employer/documents/components/marketing-pipeline/MarketingPipelineWorkspace";
import styles from "~/styles/Employer/MarketingPipeline.module.css";

export interface MarketingPipelinePanelProps {
  contextDocumentIds?: number[];
}

export function MarketingPipelinePanel({ contextDocumentIds }: MarketingPipelinePanelProps) {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className={styles.main}>
        <MarketingPipelineWorkspace contextDocumentIds={contextDocumentIds} />
      </div>
    </div>
  );
}
