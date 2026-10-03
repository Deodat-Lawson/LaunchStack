/**
 * Where a Vantage screen is, inside the Vantage tab. Vantage is a tab of the
 * workspace now, so its paths are app-relative ("/agenda?week=…") and the
 * tab's own navigation turns them into a shareable URL. One base so the rail
 * and every link agree.
 */
export const VANTAGE_BASE = "";

/** `vantagePath("")` is the tool's home, "/". */
export function vantagePath(path = ""): string {
    return `${VANTAGE_BASE}${path}` || "/";
}
