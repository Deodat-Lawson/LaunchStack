/** @jest-environment jsdom */

/**
 * The growth screens word what the server sends as copies: a run step's
 * label, a segment's headline built from its buyer types and countries. In
 * English they read exactly the server's English; in Chinese they read the
 * catalogue's; without a copy they show the server's words as they came.
 */

import React from "react";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { useSegmentText } from "~/app/employer/tools/growth/_lib/copy";
import { useCopyText } from "~/lib/tools/copyText";
import type { SegmentSummary } from "~/app/employer/tools/growth/prospects/api";
import { copy } from "~/i18n/copy";
import { renderWithLocale } from "~/i18n/testing/render";

const segment: Pick<SegmentSummary, "subtitle" | "headline" | "words"> = {
    subtitle: "NL, DE, GB · Distributors, Retailers",
    headline: "Distributors, Retailers in NL, DE and GB",
    words: {
        kinds: [
            copy("growth.server.segment.kind", { kind: "distributor" }),
            copy("growth.server.segment.kind", { kind: "retailer" }),
        ],
        countries: ["NL", "DE", "GB"],
    },
};

function Probe() {
    const word = useCopyText();
    const segmentText = useSegmentText();
    const text = segmentText(segment);
    return (
        <>
            <p data-testid="step">
                {word(
                    copy("growth.server.runs.sourcesDone", { ok: "2", total: "3" }),
                    "2 of 3 done"
                )}
            </p>
            <p data-testid="plain">{word(null, "Server words")}</p>
            <p data-testid="subtitle">{text.subtitle}</p>
            <p data-testid="headline">{text.headline}</p>
        </>
    );
}

it("reads the server's English exactly in English", () => {
    renderWithLocale(<Probe />, "en");
    expect(screen.getByTestId("step")).toHaveTextContent("2 of 3 done");
    expect(screen.getByTestId("plain")).toHaveTextContent("Server words");
    expect(screen.getByTestId("subtitle").textContent).toBe(segment.subtitle);
    expect(screen.getByTestId("headline").textContent).toBe(segment.headline);
});

it("reads Chinese in zh-CN", () => {
    renderWithLocale(<Probe />, "zh-CN");
    expect(screen.getByTestId("step")).toHaveTextContent("已完成 2/3");
    expect(screen.getByTestId("plain")).toHaveTextContent("Server words");
    expect(screen.getByTestId("subtitle").textContent).toBe("NL、DE、GB · 分销商、零售商");
    expect(screen.getByTestId("headline").textContent).toBe("NL、DE和GB 的分销商、零售商");
});
