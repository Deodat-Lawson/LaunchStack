/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { RewritePreviewPanel } from "~/app/employer/documents/components/generator/RewritePreviewPanel";

describe("RewritePreviewPanel", () => {
  it("renders before/after diff and Accept/Reject/Try again buttons", () => {
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

    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("calls onAccept when Accept is clicked", async () => {
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

    await userEvent.click(screen.getByText("Accept"));
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

  it("calls onTryAgain when Try again is clicked", async () => {
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

    await userEvent.click(screen.getByText("Try again"));
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });
});
