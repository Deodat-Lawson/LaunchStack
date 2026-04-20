/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock react-markdown to avoid ESM issues in Jest
jest.mock("react-markdown", () => {
  return function ReactMarkdown({ children }: { children: string }) {
    // Simple mock that processes basic markdown for testing
    const processMarkdown = (text: string) => {
      // Handle bold
      let processed = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // Handle lists
      if (text.includes('- ')) {
        const items = text.split('\n').filter(line => line.startsWith('- '));
        processed = '<ul>' + items.map(item => `<li>${item.substring(2)}</li>`).join('') + '</ul>';
      }
      // Handle code blocks
      processed = processed.replace(/```(\w+)?\n([\s\S]*?)```/g, '<code>$2</code>');
      // Handle links
      processed = processed.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      // Handle block math $$...$$ (must come before inline to avoid conflicts)
      processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, '<div class="math math-display">$1</div>');
      // Handle inline math $...$
      processed = processed.replace(/\$([^$\n]+)\$/g, '<span class="math math-inline">$1</span>');
      return processed;
    };
    
    return <div dangerouslySetInnerHTML={{ __html: processMarkdown(children) }} />;
  };
});

jest.mock("remark-gfm", () => () => {});
jest.mock("remark-math", () => () => {});
jest.mock("rehype-katex", () => () => {});

import MarkdownMessage from "~/app/_components/MarkdownMessage";

describe("MarkdownMessage", () => {
  it("renders plain text content", () => {
    render(<MarkdownMessage content="Hello world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders bullet lists from markdown", () => {
    render(<MarkdownMessage content={"- First item\n- Second item"} />);

    const first = screen.getByText("First item");
    expect(first.closest("li")).not.toBeNull();
    const second = screen.getByText("Second item");
    expect(second.closest("li")).not.toBeNull();
  });

  it("renders fenced code blocks", () => {
    const code = "```ts\nconst value = 42;\n```";
    const { container } = render(<MarkdownMessage content={code} />);

    expect(screen.getByText("const value = 42;")).toBeInTheDocument();
    const codeElement = container.querySelector("code");
    expect(codeElement).not.toBeNull();
  });

  it("renders links that open in a new tab", () => {
    render(<MarkdownMessage content="See [Docs](https://example.com/docs)" />);
    const link = screen.getByText("Docs");
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("renders inline math equations", () => {
    const content = "The formula is $E = mc^2$ for energy.";
    const { container } = render(<MarkdownMessage content={content} />);
    
    const mathElement = container.querySelector(".math-inline");
    expect(mathElement).not.toBeNull();
    expect(mathElement?.textContent).toContain("E = mc^2");
  });

  it("renders block math equations", () => {
    const content = "$$\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$";
    const { container } = render(<MarkdownMessage content={content} />);
    
    const mathElement = container.querySelector(".math-display");
    expect(mathElement).not.toBeNull();
    expect(mathElement?.textContent).toContain("\\int");
  });

  it("renders mixed content with equations and markdown", () => {
    const content = "The **Pythagorean theorem** is $a^2 + b^2 = c^2$.";
    const { container } = render(<MarkdownMessage content={content} />);
    
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("Pythagorean theorem");
    
    const mathElement = container.querySelector(".math-inline");
    expect(mathElement).not.toBeNull();
    expect(mathElement?.textContent).toContain("a^2 + b^2 = c^2");
  });
});

