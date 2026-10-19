export const REPORTING_ZONE = "America/New_York";

export function reportingDate(now = new Date()): string {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
            timeZone: REPORTING_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        })
            .formatToParts(now)
            .map(p => [p.type, p.value])
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validReportingDate(value: string): boolean {
    return (
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number(value.slice(0, 4)) >= 1000 &&
        !Number.isNaN(Date.parse(value)) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    );
}

export function calendarAdd(date: string, days: number): string {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

export function mondayOf(date: string): string {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    return calendarAdd(date, -(day === 0 ? 6 : day - 1));
}

export function defaultReportingWeek(now = new Date()): string {
    const today = reportingDate(now);
    const monday = mondayOf(today);
    return today === monday ? calendarAdd(monday, -7) : monday;
}

export function formatReportingInstant(iso: string): string {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: REPORTING_ZONE,
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
    }).format(new Date(iso));
}
