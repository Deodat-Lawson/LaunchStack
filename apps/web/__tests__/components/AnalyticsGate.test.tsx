/** @jest-environment jsdom */

/**
 * Analytics never loads on a public link's page: its address is the secret
 * that opens the file (ADR-016).
 */

import React from "react";
import { render } from "@testing-library/react";

let mockPath = "/employer/documents";
jest.mock("next/navigation", () => ({ usePathname: () => mockPath }));
jest.mock("@vercel/analytics/next", () => ({ Analytics: () => <i data-testid="analytics" /> }));
const mockUseSettings = jest.fn(() => ({ payload: null }));
jest.mock("~/lib/settings/useSettings", () => ({ useSettingsPayload: () => mockUseSettings() }));

import { AnalyticsGate } from "~/app/_components/AnalyticsGate";

describe("AnalyticsGate", () => {
    beforeEach(() => mockUseSettings.mockClear());

    it("loads analytics in the workspace", () => {
        mockPath = "/employer/documents";
        const { queryByTestId } = render(<AnalyticsGate />);
        expect(queryByTestId("analytics")).not.toBeNull();
    });

    it("never loads it, or asks for settings, on a public link", () => {
        mockPath = "/s/" + "a".repeat(43);
        const { queryByTestId } = render(<AnalyticsGate />);
        expect(queryByTestId("analytics")).toBeNull();
        expect(mockUseSettings).not.toHaveBeenCalled();
    });

    it("still honours a member's opt-out", () => {
        mockPath = "/employer/documents";
        mockUseSettings.mockReturnValueOnce({
            payload: { settings: { "privacy.productAnalytics": { value: false } } },
        } as never);
        const { queryByTestId } = render(<AnalyticsGate />);
        expect(queryByTestId("analytics")).toBeNull();
    });
});
