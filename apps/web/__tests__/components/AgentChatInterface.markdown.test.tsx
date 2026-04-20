/** @jest-environment jsdom */

import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock react-markdown to avoid ESM issues in Jest
jest.mock("react-markdown", () => {
  return function ReactMarkdown({ children }: { children: string }) {
    const processMarkdown = (text: string) => {
      let processed = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      return processed;
    };
    return <div dangerouslySetInnerHTML={{ __html: processMarkdown(children) }} />;
  };
});

jest.mock("remark-gfm", () => () => {});
jest.mock("remark-math", () => () => {});
jest.mock("rehype-katex", () => () => {});

import MarkdownMessage from "~/app/_components/MarkdownMessage";

describe("MarkdownMessage (integration)", () => {
  it("renders strong text for bold markdown", () => {
    const content = "This is **important** text.";
    const { container } = render(<MarkdownMessage content={content} />);

    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    if (strong) {
      expect(strong.textContent).toBe("important");
    }
    // Verify the text is present (split across elements)
    expect(container.textContent).toContain("This is");
    expect(container.textContent).toContain("important");
    expect(container.textContent).toContain("text.");
  });
});

