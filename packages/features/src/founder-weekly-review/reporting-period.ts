import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

import type { ReportingPeriod } from "./contracts";

dayjs.extend(utc);
dayjs.extend(timezone);

export interface ReportingPeriodBounds {
    startInclusive: Date;
    endExclusive: Date;
}

// convert calendar dates in workspace timezone to UTC for querying
// end is the last included day
export function resolveReportingPeriodBounds(
    period: ReportingPeriod,
    workspaceTimezone: string
): ReportingPeriodBounds {
    assertValidTimeZone(workspaceTimezone);

    const startInclusive = dayjs.tz(
        `${period.start}T00:00:00`,
        workspaceTimezone
    );

    const endExclusive = dayjs.tz(
        `${period.end}T00:00:00`,
        workspaceTimezone
    ).add(1, "day");

    return {
        startInclusive: startInclusive.toDate(),
        endExclusive: endExclusive.toDate(),
    };
}

// dayjs.tz throws dayjs's own error for a bad zone; validate up front so callers
// get a clear, feature-specific message instead.
function assertValidTimeZone(timeZone: string): void {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone });
    } catch {
        throw new Error(`Invalid workspace timezone: ${timeZone}`);
    }
}
