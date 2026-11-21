/**
 * A shared file's text as HTML, rendered on the server so it is in the page
 * before any JavaScript runs: a person with scripts off, a screen reader and
 * an AI agent reading the HTML all get the words.
 *
 * Plain react-markdown with GFM, no raw HTML (it is dropped, never run) and
 * the default URL filter (no `javascript:` links). Images are not loaded: an
 * indexed page's images point at other sites, or at files behind a session,
 * so loading them would tell a third party who opened the link, or show a
 * broken picture. Their alt text stays.
 */

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const COMPONENTS: Components = {
    a: ({ node: _node, ...props }) => (
        <a {...props} target="_blank" rel="noopener noreferrer nofollow ugc" />
    ),
    img: ({ alt }) => (alt ? <span className="text-ink-3 italic">{alt}</span> : null),
    table: ({ node: _node, ...props }) => (
        <div className="my-4 overflow-x-auto">
            <table {...props} />
        </div>
    ),
};

/**
 * Reading typography from the design tokens; long lines and wide blocks
 * scroll in place. Joined, not `cn`-merged: tailwind-merge has no reason to
 * second-guess a fixed list.
 */
const PROSE = [
    "text-ink-2 min-w-0 text-[15px] leading-7 [overflow-wrap:anywhere]",
    "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
    "[&_h1]:text-ink [&_h1]:mb-3 [&_h1]:mt-8 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight",
    "[&_h2]:text-ink [&_h2]:mb-2 [&_h2]:mt-7 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-snug",
    "[&_h3]:text-ink [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold",
    "[&_h4]:text-ink [&_h4]:mb-2 [&_h4]:mt-5 [&_h4]:font-semibold",
    "[&_h5]:text-ink [&_h5]:mb-1 [&_h5]:mt-4 [&_h5]:font-semibold",
    "[&_h6]:text-ink-3 [&_h6]:mb-1 [&_h6]:mt-4 [&_h6]:font-semibold",
    "[&_p]:my-3 [&_strong]:text-ink [&_strong]:font-semibold",
    "[&_a]:text-brand-ink [&_a]:underline [&_a]:underline-offset-2",
    "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1",
    "[&_blockquote]:border-line [&_blockquote]:text-ink-3 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:pl-4",
    "[&_hr]:border-line [&_hr]:my-6",
    "[&_code]:bg-panel-2 [&_code]:text-ink [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]",
    "[&_pre]:bg-panel-2 [&_pre]:border-line [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:p-4 [&_pre]:[overflow-wrap:normal]",
    "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
    "[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
    "[&_th]:border-line [&_th]:bg-panel-2 [&_th]:text-ink [&_th]:border [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold",
    "[&_td]:border-line [&_td]:border [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top",
].join(" ");

export function PublicMarkdown({ markdown, className }: { markdown: string; className?: string }) {
    return (
        <div className={className ? `${PROSE} ${className}` : PROSE}>
            <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
                {markdown}
            </Markdown>
        </div>
    );
}
