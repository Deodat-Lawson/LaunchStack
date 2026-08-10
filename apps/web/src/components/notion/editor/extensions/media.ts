/**
 * Media block nodes: image, video, audio, file, bookmark, embed.
 *
 * All six are leaf nodes — their payload lives entirely in attributes, and the
 * caption is an attribute rather than child content so that pressing Enter in
 * a caption cannot accidentally split the block.
 */

import { mergeAttributes, Node, nodePasteRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { attrText } from "~/lib/prosemirror-attrs";
import { detectProvider } from "../../lib/embeds";
import {
    AudioBlockView,
    BookmarkView,
    EmbedBlockView,
    FileBlockView,
    ImageBlockView,
    VideoBlockView,
} from "../nodeviews/MediaViews";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        media: {
            setImageBlock: (attrs?: { src?: string | null; caption?: string }) => ReturnType;
            setVideoBlock: (attrs?: { src?: string | null }) => ReturnType;
            setAudioBlock: (attrs?: { src?: string | null }) => ReturnType;
            setFileBlock: (attrs?: { src?: string | null; name?: string }) => ReturnType;
            setBookmark: (attrs?: { url?: string | null }) => ReturnType;
            setEmbedBlock: (attrs?: { url?: string | null; provider?: string }) => ReturnType;
        };
    }
}

/** Attributes every media block shares, so a caption behaves the same in each. */
function attribute(name: string, fallback: unknown = null) {
    return {
        default: fallback,
        parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`) ?? fallback,
        renderHTML: (attributes: Record<string, unknown>) =>
            attributes[name] === null || attributes[name] === undefined
                ? {}
                : { [`data-${name}`]: attrText(attributes[name]) },
    };
}

function numericAttribute(name: string, fallback: number | null = null) {
    return {
        default: fallback,
        parseHTML: (element: HTMLElement) => {
            const raw = element.getAttribute(`data-${name}`);
            return raw === null ? fallback : Number.parseFloat(raw);
        },
        renderHTML: (attributes: Record<string, unknown>) =>
            attributes[name] === null || attributes[name] === undefined
                ? {}
                : { [`data-${name}`]: attrText(attributes[name]) },
    };
}

export const ImageBlock = Node.create({
    name: "imageBlock",
    group: "block",
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            src: attribute("src"),
            alt: attribute("alt", ""),
            caption: attribute("caption", ""),
            align: attribute("align", "center"),
            width: numericAttribute("width"),
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-type="image-block"]' }, { tag: "img[src]" }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            "div",
            mergeAttributes(HTMLAttributes, { "data-type": "image-block" }),
            ["img", { src: (HTMLAttributes as Record<string, string>)["data-src"] ?? "" }],
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(ImageBlockView);
    },

    addCommands() {
        return {
            setImageBlock:
                (attrs) =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name, attrs: attrs ?? {} }),
        };
    },

    addPasteRules() {
        return [
            nodePasteRule({
                // A bare image URL on its own line becomes an image block, the
                // way pasting one into Notion does.
                find: /(?:^|\s)(https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|svg))(?:\s|$)/gi,
                type: this.type,
                getAttributes: (match) => ({ src: match[1] }),
            }),
        ];
    },
});

export const VideoBlock = Node.create({
    name: "videoBlock",
    group: "block",
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            src: attribute("src"),
            caption: attribute("caption", ""),
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-type="video-block"]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ["div", mergeAttributes(HTMLAttributes, { "data-type": "video-block" })];
    },

    addNodeView() {
        return ReactNodeViewRenderer(VideoBlockView);
    },

    addCommands() {
        return {
            setVideoBlock:
                (attrs) =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name, attrs: attrs ?? {} }),
        };
    },
});

export const AudioBlock = Node.create({
    name: "audioBlock",
    group: "block",
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            src: attribute("src"),
            name: attribute("name", ""),
            caption: attribute("caption", ""),
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-type="audio-block"]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ["div", mergeAttributes(HTMLAttributes, { "data-type": "audio-block" })];
    },

    addNodeView() {
        return ReactNodeViewRenderer(AudioBlockView);
    },

    addCommands() {
        return {
            setAudioBlock:
                (attrs) =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name, attrs: attrs ?? {} }),
        };
    },
});

export const FileBlock = Node.create({
    name: "fileBlock",
    group: "block",
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            src: attribute("src"),
            name: attribute("name", ""),
            size: numericAttribute("size"),
            contentType: attribute("contentType", ""),
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-type="file-block"]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ["div", mergeAttributes(HTMLAttributes, { "data-type": "file-block" })];
    },

    addNodeView() {
        return ReactNodeViewRenderer(FileBlockView);
    },

    addCommands() {
        return {
            setFileBlock:
                (attrs) =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name, attrs: attrs ?? {} }),
        };
    },
});

export const Bookmark = Node.create({
    name: "bookmark",
    group: "block",
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            url: attribute("url"),
            title: attribute("title", ""),
            description: attribute("description", ""),
            image: attribute("image"),
            favicon: attribute("favicon"),
            siteName: attribute("siteName", ""),
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-type="bookmark"]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ["div", mergeAttributes(HTMLAttributes, { "data-type": "bookmark" })];
    },

    addNodeView() {
        return ReactNodeViewRenderer(BookmarkView);
    },

    addCommands() {
        return {
            setBookmark:
                (attrs) =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name, attrs: attrs ?? {} }),
        };
    },
});

export const EmbedBlock = Node.create({
    name: "embedBlock",
    group: "block",
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            url: attribute("url"),
            provider: attribute("provider"),
            caption: attribute("caption", ""),
            height: numericAttribute("height", 420),
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-type="embed-block"]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ["div", mergeAttributes(HTMLAttributes, { "data-type": "embed-block" })];
    },

    addNodeView() {
        return ReactNodeViewRenderer(EmbedBlockView);
    },

    addCommands() {
        return {
            setEmbedBlock:
                (attrs) =>
                ({ commands }) =>
                    commands.insertContent({
                        type: this.name,
                        attrs: {
                            ...attrs,
                            provider:
                                attrs?.provider ??
                                (attrs?.url ? detectProvider(attrs.url) : null),
                        },
                    }),
        };
    },
});
