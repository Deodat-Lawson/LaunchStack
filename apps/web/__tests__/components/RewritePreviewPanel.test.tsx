/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { RewritePreviewPanel } from "~/app/employer/documents/components/generator/RewritePreviewPanel";

describe("RewritePreviewPanel", () => {
  it("renders side-by-side diff with Accept/Reject/Regenerate controls", () => {
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

    expect(screen.getByText("Accept section")).toBeInTheDocument();
    expect(screen.getByText("Reject section")).toBeInTheDocument();
    expect(screen.getByText("Regenerate")).toBeInTheDocument();
    // Both panes show their eyebrow labels
    expect(screen.getByText("Original")).toBeInTheDocument();
    expect(screen.getByText("Proposed")).toBeInTheDocument();
  });

  it("calls onAccept when Accept section is clicked", async () => {
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

    await userEvent.click(screen.getByText("Accept section"));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("calls onReject when Reject section is clicked", async () => {
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

    await userEvent.click(screen.getByText("Reject section"));
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

  it("hides the Why-this-change card when nothing changed", () => {
    const onAccept = jest.fn();
    const onReject = jest.fn();
    const onTryAgain = jest.fn();

    render(
      <RewritePreviewPanel
        originalText="identical text"
        proposedText="identical text"
        onAccept={onAccept}
        onReject={onReject}
        onTryAgain={onTryAgain}
      />
    );

    expect(screen.queryByText("Why this change")).not.toBeInTheDocument();
    expect(screen.getByText("no edits · matches source")).toBeInTheDocument();
  });
});
