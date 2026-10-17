/**
 * How a resolution failure reaches the caller.
 *
 * The two failure shapes point at different people. "This route cannot serve
 * your request" is a 400 the caller can act on; "the model file is wrong" is a
 * 500 only the operator can. A handler that lets both fall through to its
 * outer catch collapses them into one generic 500 and sends whoever is
 * debugging to the wrong place.
 *
 * Kept out of chat-routing.test.ts because `~/lib/models` reaches `~/env`,
 * whose `import.meta` usage the Jest loader cannot parse — the same issue that
 * puts nine other suites in CI's ignore list.
 */

jest.mock("~/env", () => ({ env: { server: {} } }));

import {
    ChatConfigurationError,
    ChatRouteUnavailableError,
    InvalidReasoningControlError,
} from "@launchstack/llm";
import { describeChatResolutionFailure } from "~/lib/models";

describe("describeChatResolutionFailure", () => {
    it("reports an unavailable route as the caller's 400", () => {
        const error = new ChatRouteUnavailableError({
            route: "vision",
            reason: "route-not-configured",
            message: "No vision-capable model is configured",
        });

        expect(describeChatResolutionFailure(error)).toEqual({
            status: 400,
            message: "No vision-capable model is configured",
        });
    });

    it("reports a rejected reasoning control as a 400", () => {
        expect(
            describeChatResolutionFailure(
                new InvalidReasoningControlError("effort must be one of: low, high")
            ).status
        ).toBe(400);
    });

    // The configuration error quotes the file path, model ids and preset names,
    // and this message reaches every user; the detail goes to the server log.
    const FIXED =
        "Chat models are not configured correctly. An administrator needs to check the server's chat model file.";
    const quietly = () => jest.spyOn(console, "error").mockImplementation(() => {});
    afterEach(() => jest.restoreAllMocks());

    it("reports a broken configuration as the operator's 500 without its detail", () => {
        quietly();
        expect(
            describeChatResolutionFailure(
                new ChatConfigurationError(
                    'Model "vendor/secret-9" in /srv/config/chat-models.prod.yaml has unknown preset'
                )
            )
        ).toEqual({ status: 500, message: FIXED });
    });

    it("still answers when something that is not an Error is thrown", () => {
        quietly();
        expect(describeChatResolutionFailure("kaboom")).toEqual({ status: 500, message: FIXED });
    });
});
