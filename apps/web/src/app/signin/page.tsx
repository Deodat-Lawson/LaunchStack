import { Suspense } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { isAtAccountLimit } from "~/lib/auth/device-accounts";

import { enabledSocialProviders } from "~/server/auth/providers";
import { SignInView } from "./SignInView";

export default async function SigninPage() {
    // Rendered per request, not at build: a prebuilt image learns which
    // social providers it has from the environment it runs in.
    await connection();
    // Read from the cookies here, not in the browser: the session cookies
    // are httpOnly. Only matters with ?add=1 (adding another account).
    const accountLimitReached = isAtAccountLimit((await cookies()).getAll());
    return (
        <Suspense>
            <SignInView
                socialProviders={enabledSocialProviders()}
                accountLimitReached={accountLimitReached}
            />
        </Suspense>
    );
}
