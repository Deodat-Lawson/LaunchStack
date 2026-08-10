import type { ReactNode } from "react";

import "~/components/notion/notion.css";

/**
 * The workspace runs full-bleed: it manages its own sidebar and scroll
 * containers, so it opts out of the surrounding page padding.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
    return <div className="ntn-layout">{children}</div>;
}
