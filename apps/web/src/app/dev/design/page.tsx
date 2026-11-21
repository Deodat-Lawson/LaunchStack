import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { DesignLibrary } from "./DesignLibrary";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

/**
 * The LaunchStack design library: the kit, the shared tool pieces, the
 * foundations they are built on, where each kind of UI goes, and a complete
 * template tool to copy — all rendered from the real components, in either
 * theme and language. The written rules are apps/web/DESIGN.md; this page is
 * what they look like. No login, no backend. Development only (and Compose
 * stacks that set ENABLE_DEV_ROUTES).
 *
 * Switches: `?theme=light|dark`, `#templates` and the other section ids.
 */
export default function DesignLibraryPage() {
    if (!devRoutesEnabled()) notFound();
    return <DesignLibrary />;
}
