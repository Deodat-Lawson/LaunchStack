/** Where Vantage lives. One base so the rail and every link agree. */
export const VANTAGE_BASE = "/employer/tools/vantage";

export function vantagePath(path = ""): string {
    return `${VANTAGE_BASE}${path}`;
}
