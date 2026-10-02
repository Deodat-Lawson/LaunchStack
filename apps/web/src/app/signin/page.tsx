import { Suspense } from "react";
import { connection } from "next/server";

import { enabledSocialProviders } from "~/server/auth/providers";
import { SignInView } from "./SignInView";

export default async function SigninPage() {
    // Rendered per request, not at build: a prebuilt image learns which
    // social providers it has from the environment it runs in.
    await connection();
    return (
        <Suspense>
            <SignInView socialProviders={enabledSocialProviders()} />
        </Suspense>
    );
}
