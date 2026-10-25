import { useTranslations } from "next-intl";

import { cn } from "~/lib/utils";

const linkClass = "text-ink-2 underline underline-offset-2 hover:text-ink";

/**
 * The Terms and Privacy Policy on the sign-in and sign-up screens. Google's
 * OAuth verification requires the privacy policy to be "prominently displayed
 * in your app interface", not only on the marketing site.
 *
 * Plain anchors to the same-origin /terms and /privacy routes, which redirect
 * to the public site at request time; they open in a new tab so a half-filled
 * form survives.
 */
export function AuthLegalLinks({ className }: { className?: string }) {
    const t = useTranslations("auth.legal");
    return (
        <p className={cn("text-ink-3 m-0 text-center text-[11.5px] leading-[1.5]", className)}>
            {t.rich("agreement", {
                terms: chunks => (
                    <a
                        href="/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={linkClass}
                    >
                        {chunks}
                    </a>
                ),
                privacy: chunks => (
                    <a
                        href="/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={linkClass}
                    >
                        {chunks}
                    </a>
                ),
            })}
        </p>
    );
}
