import { redirect } from "next/navigation";

/**
 * This origin is the product. The public site lives on its own origin — see
 * apps/landing.
 *
 * An authenticated visitor never reaches this component: `/` is in
 * middleware's isAuthRedirectRoute, which fans them out to their dashboard,
 * /workspaces, or a pending-approval page first. Reaching here means either
 * anonymous — in which case the front door of an app is its sign-in page — or
 * that the middleware's database lookup threw and it failed open.
 *
 * That second case is why the redirect lives in middleware's `!userId` branch
 * as well. If this component were the only thing redirecting, a signed-in
 * session plus an unreachable database would bounce / -> /signin -> (the sign-in
 * sees a session, honours forceRedirectUrl) -> / forever. The degraded path
 * has to terminate somewhere, and `apps/web/src/app/signin/page.tsx` renders
 * an explicit already-signed-in state rather than a fresh sign-in form.
 */
export default function RootPage() {
    redirect("/signin");
}
