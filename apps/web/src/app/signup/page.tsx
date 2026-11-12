import { cookies } from "next/headers";

import { isAtAccountLimit } from "~/lib/auth/device-accounts";
import { SignupView } from "./SignupView";

/**
 * `/signup`. The view is a client component; this reads the one thing it
 * needs from the cookies, which are httpOnly: whether this browser already
 * holds the most accounts it keeps (only consulted with ?add=1).
 */
export default async function SignupPage() {
    const accountLimitReached = isAtAccountLimit((await cookies()).getAll());
    return <SignupView accountLimitReached={accountLimitReached} />;
}
