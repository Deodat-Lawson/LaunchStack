/**
 * Company metadata is the company profile now, a screen of the Workspace tab,
 * not a page of its own.
 *
 * The route survives as a redirect because it has been linked from onboarding,
 * from the command palette, and from anywhere people bookmarked it. The
 * screen renders the shared company profile
 * (`~/components/company-profile/CompanyProfileView`), the same one
 * Proposals › Profile shows.
 */

import { redirect } from "next/navigation";

import { workspaceHref } from "~/lib/settings/surfaces";

export default function MetadataPage() {
    redirect(workspaceHref("company"));
}
