/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ChatMarkdown, safeChatUri } from "../ChatMarkdown";
import { copyText } from "~/lib/context-menu";

jest.mock("~/lib/context-menu", () => ({ copyText: jest.fn(async () => true) }));
jest.mock("mermaid", () => ({
    __esModule: true,
    default: {
        initialize: jest.fn(),
        render: jest.fn(async () => ({ svg: '<svg role="img"><text>Diagram</text></svg>' })),
    },
}));
beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
});
it("renders GFM lists/tasks/tables/math and sanitizes model HTML/URLs", () => {
    const { container } = render(
        <ChatMarkdown
            text={
                '# Result\n\n- [x] Verified\n- Pending\n\n| Name | Value |\n| --- | --- |\n| A | 2 |\n\n$x^2$\n\n<a href="javascript:alert(1)" onclick="alert(1)">Bad link</a><script>dangerous()</script><img src="data:image/svg+xml;base64,aaa" onerror="alert(1)" alt="blocked">\n\n[Safe](https://example.com)'
            }
        />
    );
    expect(screen.getByRole("heading", { name: "Result" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelector(".katex")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onclick], [onerror]")).toBeNull();
    expect(screen.getByText("Bad link").closest("a")).toBeNull();
    expect(container.querySelector('img[src^="data:"]')).toBeNull();
    expect(screen.getByRole("link", { name: "Safe" })).toHaveAttribute(
        "rel",
        "noopener noreferrer"
    );
});
it("copies table values as CSV with quote escaping and as Markdown", async () => {
    render(<ChatMarkdown text={'| Name | Value |\n| --- | --- |\n| A, B | Say "yes" |'} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy as CSV" }));
    await waitFor(() =>
        expect(copyText).toHaveBeenCalledWith('"Name","Value"\n"A, B","Say ""yes"""')
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));
    expect(copyText).toHaveBeenCalledWith('| Name | Value |\n| --- | --- |\n| A, B | Say "yes" |');
});
it("keeps original code copy and persists line wrap preference", async () => {
    const text = '```typescript\nconst greeting = "hello";\n```';
    const { unmount } = render(<ChatMarkdown text={text} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('const greeting = "hello";'));
    fireEvent.click(screen.getByRole("button", { name: "Wrap code lines" }));
    expect(localStorage.getItem("launchstack.chat.wrapCode")).toBe("true");
    unmount();
    render(<ChatMarkdown text={text} />);
    await waitFor(() =>
        expect(screen.getByRole("button", { name: "Wrap code lines" })).toHaveAttribute(
            "aria-pressed",
            "true"
        )
    );
});
it("renders Mermaid using strict security and the unchanged source", async () => {
    const source = 'graph TD\nA["literal \\n label"] --> B';
    render(<ChatMarkdown text={"```mermaid\n" + source + "\n```"} />);
    const mermaid = (await import("mermaid")).default;
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), source));
    expect(mermaid.initialize).toHaveBeenCalledWith(
        expect.objectContaining({ securityLevel: "strict" })
    );
});
it("opens safe image gallery with keyboard navigation and original link", () => {
    render(
        <ChatMarkdown
            text={
                "![First](https://example.com/first.png)\n\n![Second](https://example.com/second.png)"
            }
        />
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview image: First" }));
    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("link", { name: "Original" })).toHaveAttribute(
        "href",
        "https://example.com/first.png"
    );
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(screen.getByRole("link", { name: "Original" })).toHaveAttribute(
        "href",
        "https://example.com/second.png"
    );
});
it.each([
    "javascript:alert(1)",
    "data:image/svg+xml;base64,abc",
    "file:///etc/passwd",
    "blob:https://example.com/1",
    "//evil.example/file",
    "https://user:pass@example.com/image",
    " java\nscript:alert(1)",
])("rejects unsafe media URI %s", uri => expect(safeChatUri(uri, true)).toBeUndefined());
it("allows genuine safe source/media URIs", () => {
    expect(safeChatUri("/api/files/abc", true)).toBe("/api/files/abc");
    expect(safeChatUri("https://example.com/image.png", true)).toBe(
        "https://example.com/image.png"
    );
    expect(safeChatUri("#chat-message-one")).toBe("#chat-message-one");
});

it("renders GitHub alerts without leaking the source marker", () => {
    render(<ChatMarkdown text={"> [!WARNING]\n> Check this assumption."} />);
    expect(screen.getByRole("note", { name: "warning" })).toHaveTextContent(
        "Check this assumption."
    );
    expect(screen.queryByText("[!WARNING]")).toBeNull();
});

it("opens long table cell details and copies the full content", async () => {
    const content = "A long detail with complete context for a table cell. ".repeat(4);
    render(<ChatMarkdown text={`| Detail |\n| --- |\n| ${content} |`} />);
    fireEvent.click(screen.getByRole("button", { name: "View full table cell" }));
    expect(await screen.findByRole("dialog", { name: "Full table cell" })).toHaveTextContent(
        content.trim()
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy cell" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(content.trim()));
});
