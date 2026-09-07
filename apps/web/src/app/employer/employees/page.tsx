import { redirect } from "next/navigation";

/**
 * The people list is a section of Settings now. This route survives only so
 * old bookmarks, emails, and the retired `?view=employees` links still land
 * somewhere useful.
 */
export default function EmployeesRedirect() {
    redirect("/employer/settings#people");
}
