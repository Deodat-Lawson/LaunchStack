import { cn } from "~/lib/utils";

import pill from "./WorkspaceSwitcherPill.module.css";

/**
 * A workspace's mark: its initials on its colour (swatch 1–6). The one
 * drawing of it, shared by the workspace card in Settings and the colour
 * picker in Workspace › General, so the colour chosen there is the one shown. The swatches are fixed brand gradients, not theme
 * tokens: a workspace's colour does not change with the viewer's theme.
 */
export function WorkspaceMark({
    swatch,
    initials,
    className,
}: {
    swatch: number | null | undefined;
    initials: string;
    className?: string;
}) {
    return (
        <span
            className={cn(pill.mark, pill[`gradient${swatch ?? 1}`] ?? pill.gradient1, className)}
        >
            {initials}
        </span>
    );
}
