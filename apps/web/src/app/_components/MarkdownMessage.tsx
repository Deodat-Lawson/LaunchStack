"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import clsx from "clsx";
import "katex/dist/katex.min.css";

export interface MarkdownMessageProps {
  content: string;
  className?: string;
}

const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, className }) => {
  return (
    <div className={clsx("max-w-full", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
            <p className="my-1 leading-relaxed" {...props} />
          ),
          ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
            <ul className="list-disc ml-4 my-1 space-y-1" {...props} />
          ),
          ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
            <ol className="list-decimal ml-4 my-1 space-y-1" {...props} />
          ),
          li: (props: React.HTMLAttributes<HTMLLIElement>) => (
            <li className="leading-relaxed" {...props} />
          ),
          code: ({ inline, className: codeClassName, children, ...props }: React.HTMLAttributes<HTMLElement> & { inline?: boolean; className?: string }) => {
            const combinedClassName = inline
              ? clsx(
                  "px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[0.85em]",
                  codeClassName,
                )
              : clsx(
                  "block w-full rounded bg-slate-950/90 text-slate-50 p-3 overflow-x-auto text-xs",
                  codeClassName,
                );

            return (
              <code className={combinedClassName} {...props}>
                {children}
              </code>
            );
          },
          a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
            <a
              {...props}
              className={clsx(
                "text-purple-700 dark:text-purple-300 underline underline-offset-2 hover:text-purple-800 dark:hover:text-purple-200",
                props.className,
              )}
              target="_blank"
              rel="noopener noreferrer"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownMessage;

