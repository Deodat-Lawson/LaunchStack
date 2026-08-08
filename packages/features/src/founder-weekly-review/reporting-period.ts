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

    return {
        startInclusive: dayjs.tz(period.start, workspaceTimezone).startOf("day").toDate(),
        endExclusive: dayjs
            .tz(period.end, workspaceTimezone)
            .add(1, "day")
            .startOf("day")
            .toDate(),
    };
}

function assertValidTimeZone(timeZone: string): void {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone });
    } catch {
        throw new Error(`Invalid workspace timezone: ${timeZone}`);
    }
}
