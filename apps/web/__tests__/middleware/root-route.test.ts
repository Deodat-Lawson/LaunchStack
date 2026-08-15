/**
 * Middleware behaviour at `/` after the apps/landing split.
 *
 * This origin is the product; the public site moved to its own origin. `/` is
 * therefore a redirect to /signin for anonymous visitors, and the redirect has
 * to happen in middleware — before the role lookup — rather than only in
 * app/page.tsx.
 *
 * The reason is the loop these tests exist to prevent. The role lookup fails
 * open (its catch logs and falls through), and Clerk's <SignIn> honours
 * forceRedirectUrl="/" when a session already exists. So if middleware were to
 * hand an *authenticated* request at `/` on to a page component that redirects
 * to /signin, an unreachable database would produce
 * `/` -> /signin -> / -> /signin -> ... forever.
 */

import { NextRequest, type NextResponse } from "next/server";
import type * as ClerkServer from "@clerk/nextjs/server";

type MiddlewareHandler = (
  auth: (() => Promise<{ userId: string | null }>) & { protect: jest.Mock },
  req: NextRequest,
) => Promise<NextResponse | undefined>;

type HandlerHolder = { __middlewareHandler?: MiddlewareHandler };

jest.mock("@clerk/nextjs/server", () => {
  const actual = jest.requireActual<typeof ClerkServer>("@clerk/nextjs/server");
  return {
    ...actual,
    clerkMiddleware: (handler: MiddlewareHandler) => {
      (globalThis as HandlerHolder).__middlewareHandler = handler;
      return handler;
    },
  };
});

import "~/middleware";

const handler = (globalThis as HandlerHolder).__middlewareHandler!;

function run(pathname: string, userId: string | null) {
  const auth = Object.assign(async () => ({ userId }), {
    protect: jest.fn(),
  });
  return handler(auth, new NextRequest(new URL(`http://localhost${pathname}`)));
}

describe("middleware at /", () => {
  it("redirects an anonymous visitor to /signin", async () => {
    const response = await run("/", null);

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("http://localhost/signin");
  });

  it("never sends an authenticated request at / to /signin", async () => {
    // No DATABASE_URL under Jest, so the role lookup throws and the handler
    // takes its fail-open path. The property that matters is that it does not
    // answer with a /signin redirect — that edge is what would close the loop.
    const response = await run("/", "clerk_abc");

    expect(response?.headers.get("location")).not.toBe(
      "http://localhost/signin",
    );
  });

  it("does not redirect anonymous visitors away from /signin itself", async () => {
    await expect(run("/signin", null)).resolves.toBeUndefined();
  });
});

describe("middleware after the apps/landing split", () => {
  // These used to be listed in isPublicRoute. They are gone from this origin
  // entirely, so middleware should have no opinion about them — the request
  // falls through and Next answers 404.
  it.each(["/pricing", "/contact", "/deployment", "/about"])(
    "has no special handling for the relocated route %s",
    async (path) => {
      await expect(run(path, null)).resolves.toBeUndefined();
    },
  );
});
