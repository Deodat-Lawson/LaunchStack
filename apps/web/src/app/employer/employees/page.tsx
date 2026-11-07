import { redirect } from "next/navigation";

import { workspaceHref } from "~/lib/settings/surfaces";

/**
 * The people list is Workspace › People and access now. This route survives
 * only so old bookmarks, emails, and the retired `?view=employees` links
 * still land somewhere useful.
 */
export default function EmployeesRedirect() {
    redirect(workspaceHref("people"));
}
