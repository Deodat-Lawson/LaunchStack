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

    // `dayjs.tz("YYYY-MM-DD", zone)` already IS local midnight in that zone, so
    // no startOf/add is needed on the zoned value — and both are actively
    // harmful here: they re-derive from the *system* offset, which silently
    // moved the bound onto the wrong day across a DST transition and made the
    // result depend on the machine running the code.
    //
    // The exclusive end is the calendar day after the last included one, so
    // advance the DATE in UTC (pure calendar arithmetic, no offsets involved)
    // and only then interpret it as local midnight.
    const dayAfterEnd = dayjs.utc(period.end).add(1, "day").format("YYYY-MM-DD");

    return {
        startInclusive: dayjs.tz(period.start, workspaceTimezone).toDate(),
        endExclusive: dayjs.tz(dayAfterEnd, workspaceTimezone).toDate(),
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
