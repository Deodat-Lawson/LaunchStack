import { announceAccountChange } from "~/lib/auth/account-sync";
import { resetMyProfile } from "~/lib/profile/use-my-profile";

/**
 * A full page load to `href`, not a client-side push: after an account
 * change the server must render for whoever is now active, and nothing this
 * tab cached (profile, people) may outlive the account it belonged to.
 */
export function reloadAs(href: string): void {
    resetMyProfile();
    // Other tabs are now acting as someone else too: tell them.
    announceAccountChange();
    window.location.assign(href);
}
