/** Writes text to the clipboard, falling back to the legacy command where the API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fall through to the legacy path.
        }
    }
    if (typeof document === "undefined") return false;
    try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand("copy");
        area.remove();
        return ok;
    } catch {
        return false;
    }
}

/** Reads clipboard text; null when the browser refuses (permission, insecure context). */
export async function readClipboardText(): Promise<string | null> {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return null;
    try {
        return await navigator.clipboard.readText();
    } catch {
        return null;
    }
}
