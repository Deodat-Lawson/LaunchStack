import type { ReportingPeriod } from "./contracts.js";
export interface ReportingPeriodBounds {
    startInclusive: Date;
    endExclusive: Date;
}
export declare function resolveReportingPeriodBounds(period: ReportingPeriod, workspaceTimezone: string): ReportingPeriodBounds;
//# sourceMappingURL=reporting-period.d.ts.map