import { SHORTCUT_COMMANDS_BY_ID, formatKeys } from "~/lib/shortcuts/commands";

/**
 * The keys the feedback copy mentions, as this platform writes them (⌘⌥B on
 * a Mac, Ctrl+Alt+B elsewhere). Defaults, not a member's remapping: the copy
 * is a hint, and Settings › Shortcuts is where the real binding lives.
 */
export function feedbackKeys() {
    const keys = (id: string) => formatKeys(SHORTCUT_COMMANDS_BY_ID.get(id)?.defaultKeys ?? "");
    return {
        report: keys("feedback.report"),
        palette: keys("palette.toggle"),
        send: formatKeys("Mod+Enter"),
        paste: formatKeys("Mod+V"),
    };
}
