/** @jest-environment jsdom */

/**
 * `useCopyText` says a server sentence's copy in the reader's language and
 * falls back to the English the server sent: when there is no copy, or when
 * this build's catalogue does not know the key.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { Copy } from "~/i18n/copy";
import { renderWithLocale } from "~/i18n/testing/render";

import { useCopyText } from "../copyText";

function Line({ copy, english }: { copy?: Copy; english: string }) {
    const say = useCopyText();
    return <p>{say(copy, english)}</p>;
}

const headline: Copy = {
    key: "proposals.server.headlines.drafted",
    values: { count: 3 },
};

describe("useCopyText", () => {
    it("words the copy in Chinese", () => {
        renderWithLocale(<Line copy={headline} english="3 sections drafted" />, "zh-CN");
        expect(screen.getByText("已起草 3 个章节")).toBeInTheDocument();
    });

    it("reads the same English without a provider", () => {
        render(<Line copy={headline} english="3 sections drafted" />);
        expect(screen.getByText("3 sections drafted")).toBeInTheDocument();
    });

    it("shows the server's English when there is no copy or the key is unknown", () => {
        renderWithLocale(
            <>
                <Line english="youth, literacy" />
                <Line
                    copy={{ key: "proposals.server.headlines.notAKey" as Copy["key"] }}
                    english="Something newer"
                />
            </>,
            "zh-CN"
        );
        expect(screen.getByText("youth, literacy")).toBeInTheDocument();
        expect(screen.getByText("Something newer")).toBeInTheDocument();
    });
});
