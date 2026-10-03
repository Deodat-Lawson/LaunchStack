/** @jest-environment jsdom */

/**
 * Hydration must survive a client chunk that resolves mid-hydration.
 *
 * In the App Router a server layout hands its client shell `children` as a
 * Flight lazy node: `DriftShell` renders `<div className={styles.body}>
 * {children}</div>`, and that child is pending until the page's client chunk
 * is ready. When the chunk's script has loaded but its resolution is still
 * sitting in the microtask queue — routine when the dev server or the network
 * is slow — React suspends while reconciling the div's children, yields for
 * microtasks, sees the chunk resolved, and *replays* the div instead of
 * unwinding. The React that Next 15.5 vendors (19.2.0-canary-0bdb9206)
 * replays without rewinding its hydration cursor, so the div claims its own
 * first child and every node after it is off by one: the intermittent
 * "Hydration failed because the server rendered HTML didn't match the client"
 * on /employer/settings, whose diff points wherever the late chunk was.
 *
 * A second bug rides the same replay: the replayed element loses its
 * `Forked` flag, so it stops contributing to the `useId` tree path and every
 * id beneath it differs from the server's (Radix's `aria-controls` in the
 * settings section picker, reported as "A tree hydrated but some attributes
 * … didn't match").
 *
 * Upstream fixed these in facebook/react#35494 and #35518 (React 19.3.0); we
 * carry both as `patches/next@15.5.7.patch`. This drives that exact path
 * against the React builds Next serves, development and production, and
 * fails without the patch.
 */

import type * as ReactTypes from "react";
import type * as ReactDOMClientTypes from "react-dom/client";
import type * as ReactDOMServerTypes from "react-dom/server";

type ReactModule = typeof ReactTypes;
type ReactDOMClientModule = typeof ReactDOMClientTypes;
type ReactDOMServerModule = typeof ReactDOMServerTypes;

function loadNextReact(nodeEnv: "development" | "production") {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    let modules:
        | {
              React: ReactModule;
              ReactDOMClient: ReactDOMClientModule;
              ReactDOMServer: ReactDOMServerModule;
          }
        | undefined;
    jest.isolateModules(() => {
        // The vendored entry points pick their build from NODE_ENV at require time.
        env.NODE_ENV = nodeEnv;
        try {
            modules = {
                React: jest.requireActual<ReactModule>("next/dist/compiled/react"),
                ReactDOMClient: jest.requireActual<ReactDOMClientModule>(
                    "next/dist/compiled/react-dom/client"
                ),
                ReactDOMServer: jest.requireActual<ReactDOMServerModule>(
                    "next/dist/compiled/react-dom/server.node"
                ),
            };
        } finally {
            env.NODE_ENV = previous;
        }
    });
    if (!modules) throw new Error("failed to load next/dist/compiled/react-dom");
    return modules;
}

/**
 * A pending client reference in the shape React's Flight client gives it to
 * React: a lazy *node* (not a lazy component) over a thenable that carries
 * its own `status` (`createLazyChunkWrapper` + `readChunk`). React reads it,
 * it throws, and its module finishes on the next microtask — the window in
 * which React checks back and decides to replay.
 */
function lateFlightNode(resolved: () => unknown): ReactTypes.ReactNode {
    const listeners: Array<(value: unknown) => void> = [];
    const chunk = {
        status: "pending" as "pending" | "fulfilled",
        value: undefined as unknown,
        then(onFulfilled: (value: unknown) => void) {
            if (chunk.status === "fulfilled") onFulfilled(chunk.value);
            else listeners.push(onFulfilled);
        },
    };
    return {
        $$typeof: Symbol.for("react.lazy"),
        _payload: chunk,
        _init: (payload: typeof chunk) => {
            if (payload.status === "fulfilled") return payload.value;
            queueMicrotask(() => {
                if (chunk.status === "fulfilled") return;
                // Flight marks the chunk fulfilled before it wakes listeners.
                chunk.status = "fulfilled";
                chunk.value = resolved();
                for (const wake of listeners.splice(0)) wake(chunk.value);
            });
            // Suspense's protocol: a pending lazy throws its thenable.
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw payload;
        },
        // React's public types have no lazy node; Flight's are internal.
    } as unknown as ReactTypes.ReactNode;
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe.each(["development", "production"] as const)(
    "hydrating a host element whose Flight child resolves mid-render (%s build)",
    nodeEnv => {
        it("claims the server's DOM nodes and agrees on useId", async () => {
            const { React, ReactDOMClient, ReactDOMServer } = loadNextReact(nodeEnv);
            const h = React.createElement;

            // Radix's Select ties its trigger to its listbox with useId; the
            // settings section picker is one.
            const ids: string[] = [];
            function Picker() {
                const id = React.useId();
                ids.push(id);
                return h("button", { type: "button", "aria-controls": id }, "Section");
            }
            const settingsPage = () =>
                h(
                    "section",
                    { className: "settings" },
                    h(Picker),
                    h("nav", { "aria-label": "Settings sections" }, "Settings")
                );

            // Effects run once the root commits, hydrated or client-rendered.
            let committed = false;
            function Committed() {
                React.useEffect(() => {
                    committed = true;
                }, []);
                return null;
            }

            // DriftShell's shape: a back bar, then the body that holds the page.
            const shell = (page: ReactTypes.ReactNode) =>
                h(
                    "div",
                    { className: "main" },
                    h("div", { className: "bar" }, "Studio"),
                    h("div", { className: "body" }, page),
                    h(Committed)
                );

            const container = document.createElement("div");
            container.innerHTML = ReactDOMServer.renderToString(shell(settingsPage()));
            document.body.appendChild(container);
            const serverId = container.querySelector("button")?.getAttribute("aria-controls");
            const serverBody = container.querySelector(".body");
            const serverSection = container.querySelector("section");
            ids.length = 0;

            const recoverable: string[] = [];
            // React logs what it recovers from or leaves unpatched; the
            // assertions below are what report it.
            const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
            let root: ReturnType<ReactDOMClientModule["hydrateRoot"]> | undefined;
            try {
                const page = lateFlightNode(settingsPage);
                React.startTransition(() => {
                    root = ReactDOMClient.hydrateRoot(container, shell(page), {
                        onRecoverableError: error => {
                            recoverable.push(
                                error instanceof Error ? error.message : String(error)
                            );
                        },
                    });
                });
                for (let i = 0; i < 200 && !committed; i++) await tick();

                expect(committed).toBe(true);
                expect(recoverable).toEqual([]);
                // Hydrated, not thrown away and client-rendered: the server's
                // nodes are still the ones on the page.
                expect(container.querySelector(".body")).toBe(serverBody);
                expect(container.querySelector("section")).toBe(serverSection);
                // And the id the client computed is the one already in the HTML.
                expect(serverId).toBeTruthy();
                expect(ids.at(-1)).toBe(serverId);
            } finally {
                root?.unmount();
                container.remove();
                consoleError.mockRestore();
            }
        });
    }
);
