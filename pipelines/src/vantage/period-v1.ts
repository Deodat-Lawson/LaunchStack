import { VantageError } from "./db";
import type { ReportPeriod } from "./contract-v1";

const zone = "America/New_York";
const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
});
export function reportingDate(now: Date): string {
    const p = Object.fromEntries(formatter.formatToParts(now).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
}
export function validDate(value: string): boolean {
    return (
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number(value.slice(0, 4)) >= 1000 &&
        !Number.isNaN(Date.parse(value)) &&
        new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
    );
}
export function calendarAdd(date: string, days: number): string {
    const d = new Date(date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
export function reportingWeekOf(date: string): string {
    const day = new Date(date + "T12:00:00Z").getUTCDay();
    return calendarAdd(date, -(day === 0 ? 6 : day - 1));
}
/** Resolve local midnight using zone offsets on that date, including DST changes. */
function midnight(date: string): Date {
    const target = Date.parse(date + "T00:00:00Z");
    let guess = target;
    for (let i = 0; i < 3; i++) {
        const p = Object.fromEntries(
            formatter.formatToParts(new Date(guess)).map(x => [x.type, x.value])
        );
        const represented = Date.parse(
            `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`
        );
        guess += target - represented;
    }
    return new Date(guess);
}
export function reportPeriod(now: Date, supplied?: string): ReportPeriod {
    const today = reportingDate(now),
        current = reportingWeekOf(today);
    if (supplied !== undefined && !validDate(supplied))
        throw new VantageError("Use a real YYYY-MM-DD date.", 400, "validation_error");
    const start = supplied
        ? reportingWeekOf(supplied)
        : today === current
          ? calendarAdd(current, -7)
          : current;
    if (start > current)
        throw new VantageError("A future week cannot be generated.", 400, "future_week");
    const end = midnight(calendarAdd(start, 7));
    return {
        weekStart: start,
        timeZone: zone,
        startInclusive: midnight(start).toISOString(),
        endExclusive: new Date(Math.min(end.getTime(), now.getTime())).toISOString(),
        asOf: now.toISOString(),
        kind: end.getTime() <= now.getTime() ? "completed-week" : "week-to-date",
    };
}
