/**
 * Middleware default-deny for /api/*: anything not on the public allowlist
 * needs a Clerk session, and the rejection is a JSON 401 rather than the
 * 404/redirect that auth.protect() would produce.
 */

import { NextRequest, type NextResponse } from "next/server";
import type * as ClerkServer from "@clerk/nextjs/server";

type MiddlewareHandler = (
  auth: (() => Promise<{ userId: string | null }>) & { protect: jest.Mock },
  req: NextRequest,
) => Promise<NextResponse | undefined>;

type HandlerHolder = { __middlewareHandler?: MiddlewareHandler };

jest.mock("@clerk/nextjs/server", () => {
  const actual = jest.requireActual<typeof ClerkServer>(
    "@clerk/nextjs/server",
  );
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

const PUBLIC_API_PATHS = [
  "/api/health",
  "/api/webhooks/clerk",
  "/api/inngest",
  "/api/invite-codes/validate",
  "/api/ocr/benchmark",
  "/api/metrics",
  "/api/uploadthing",
  "/api/files/123",
  "/api/collab/hub/v1/nodes",
  "/api/collab/slack/events",
];

const PROTECTED_API_PATHS = [
  "/api/uploadDocument",
  "/api/signup/employee",
  "/api/config/ocr",
  "/api/experimental/embedding-search",
  "/api/upload-local",
  "/api/documents/1",
  "/api/invite-codes/generate",
  "/api/collab/agents",
  "/api/collab/meetings",
];

describe("middleware /api default-deny", () => {
  it.each(PUBLIC_API_PATHS)("lets anonymous requests through to %s", async (path) => {
    await expect(run(path, null)).resolves.toBeUndefined();
  });

  it.each(PROTECTED_API_PATHS)("rejects anonymous requests to %s with 401", async (path) => {
    const response = await run(path, null);

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it.each(PROTECTED_API_PATHS)("lets authenticated requests through to %s", async (path) => {
    await expect(run(path, "clerk_abc")).resolves.toBeUndefined();
  });

  it("does not redirect API callers to /signin", async () => {
    const auth = Object.assign(async () => ({ userId: null }), {
      protect: jest.fn(),
    });

    const response = await handler(
      auth,
      new NextRequest(new URL("http://localhost/api/uploadDocument")),
    );

    expect(auth.protect).not.toHaveBeenCalled();
    expect(response?.headers.get("location")).toBeNull();
  });
});
