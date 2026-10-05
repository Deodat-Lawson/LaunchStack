/**
 * Company metadata is a section of Settings now, not a page of its own.
 *
 * The route survives as a redirect because it has been linked from onboarding,
 * from the command palette, and from anywhere people bookmarked it. The
 * section renders the shared company profile
 * (`~/components/company-profile/CompanyProfileView`), the same one
 * Proposals › Profile shows.
 */

import { redirect } from "next/navigation";

export default function MetadataPage() {
    redirect("/employer/settings#company");
}
