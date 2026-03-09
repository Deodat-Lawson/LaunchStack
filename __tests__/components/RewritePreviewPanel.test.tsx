/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

jest.mock("react-markdown", () => {
  return function ReactMarkdown({ children }: { children: string }) {
    let processed = children.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    processed = processed.replace(/\*(.*?)\*/g, "<em>$1</em>");
    return <div dangerouslySetInnerHTML={{ __html: processed }} />;
  };
});

jest.mock("remark-gfm", () => () => {});
jest.mock("remark-math", () => () => {});
jest.mock("rehype-katex", () => () => {});

import { RewritePreviewPanel } from "~/app/employer/documents/components/generator/RewritePreviewPanel";

describe("RewritePreviewPanel", () => {
  it("renders before/after diff and Push to Rewrite/Reject/Regenerate buttons", () => {
    const onAccept = jest.fn();
    const onReject = jest.fn();
    const onTryAgain = jest.fn();

    render(
      <RewritePreviewPanel
        originalText="Hello world"
        proposedText="Hello there world"
        onAccept={onAccept}
        onReject={onReject}
        onTryAgain={onTryAgain}
      />
    );

    expect(screen.getByText("Push to Rewrite")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.getByText("Regenerate")).toBeInTheDocument();
  });

  it("calls onAccept when Push to Rewrite is clicked", async () => {
    const onAccept = jest.fn();
    const onReject = jest.fn();
    const onTryAgain = jest.fn();

    render(
      <RewritePreviewPanel
        originalText="foo"
        proposedText="bar"
        onAccept={onAccept}
        onReject={onReject}
        onTryAgain={onTryAgain}
      />
    );

    await userEvent.click(screen.getByText("Push to Rewrite"));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("calls onReject when Reject is clicked", async () => {
    const onAccept = jest.fn();
    const onReject = jest.fn();
    const onTryAgain = jest.fn();

    render(
      <RewritePreviewPanel
        originalText="foo"
        proposedText="bar"
        onAccept={onAccept}
        onReject={onReject}
        onTryAgain={onTryAgain}
      />
    );

    await userEvent.click(screen.getByText("Reject"));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("calls onTryAgain when Regenerate is clicked", async () => {
    const onAccept = jest.fn();
    const onReject = jest.fn();
    const onTryAgain = jest.fn();

    render(
      <RewritePreviewPanel
        originalText="foo"
        proposedText="bar"
        onAccept={onAccept}
        onReject={onReject}
        onTryAgain={onTryAgain}
      />
    );

  await userEvent.click(screen.getByText("Regenerate"));
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it("renders markdown formatting in clean view", async () => {
    const onAccept = jest.fn();
    const onReject = jest.fn();
    const onTryAgain = jest.fn();

    render(
      <RewritePreviewPanel
        originalText="Plain text"
        proposedText="**Bold** and *italic*"
        onAccept={onAccept}
        onReject={onReject}
        onTryAgain={onTryAgain}
      />
    );

    await userEvent.click(screen.getByRole("tab", { name: /clean view/i }));

    expect(screen.getByText("Bold", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("italic", { selector: "em" })).toBeInTheDocument();
  });
});
