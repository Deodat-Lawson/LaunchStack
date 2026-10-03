import { Globe } from "lucide-react";

function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

/** The web pages an answer was shown, numbered as its [Source N] citations. */
export function WebSources({ sources }: { sources: { title: string; url: string }[] }) {
    if (sources.length === 0) return null;
    return (
        <section
            aria-label="Web sources"
            className="border-line bg-line-2 mt-3.5 rounded-[10px] border px-3.5 py-3"
        >
            <div className="mono text-ink-3 mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]">
                <Globe className="size-3" aria-hidden />
                {sources.length} web source{sources.length === 1 ? "" : "s"}
            </div>
            <ol className="m-0 list-none p-0">
                {sources.map((source, index) => (
                    <li
                        key={`${index}-${source.url}`}
                        className="border-line border-t first:border-t-0"
                    >
                        <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={source.url}
                            className="text-ink hover:text-accent flex items-baseline gap-2 py-1.5 text-xs no-underline"
                        >
                            <span className="mono text-ink-3 shrink-0">[{index + 1}]</span>
                            <span className="min-w-0 flex-1 truncate font-semibold">
                                {source.title}
                            </span>
                            <span className="text-ink-3 shrink-0">{hostOf(source.url)}</span>
                        </a>
                    </li>
                ))}
            </ol>
        </section>
    );
}
