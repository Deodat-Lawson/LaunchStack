import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { LaunchstackMark } from "./LaunchstackLogo";

interface LoadingPageProps {
    /**
     * `screen` owns the viewport: a hard load, or a page whose session is
     * still resolving. `pane` fills whatever holds it: a Studio tab whose code
     * is still arriving, or the body under a page's own chrome.
     */
    variant?: "screen" | "pane";
    /** Shown beside the spinner, and what a screen reader announces. */
    label?: string;
    className?: string;
}

/**
 * The one loading state, between pages and inside panes.
 *
 * It waits a beat before it appears (`animate-loader-in`), so a load that
 * finishes quickly shows nothing rather than flashing a screen for a frame.
 * The surface behind it is painted at once, so the wait is never a white
 * flash either. One indicator, in the kit's spinner: this used to stack a
 * ring, a bar, bouncing dots and a gradient heading that vanished in dark
 * mode, and it filled the whole viewport even inside a split pane.
 */
export default function LoadingPage({
    variant = "screen",
    label = "Loading…",
    className,
}: LoadingPageProps) {
    const status = (
        <span className="text-ink-3 flex items-center gap-2 text-[13px]">
            <Spinner aria-hidden="true" className="text-brand" />
            {label}
        </span>
    );

    if (variant === "pane") {
        return (
            <div
                role="status"
                aria-live="polite"
                className={cn(
                    "animate-loader-in flex h-full min-h-48 w-full flex-1 items-center justify-center",
                    className
                )}
            >
                {status}
            </div>
        );
    }

    return (
        <div
            role="status"
            aria-live="polite"
            className={cn(
                "bg-surface text-ink relative flex min-h-dvh w-full items-center justify-center overflow-hidden",
                className
            )}
        >
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,var(--accent-soft),transparent)]"
            />
            <div className="animate-loader-in relative flex flex-col items-center gap-5">
                {/* Decoration: the status announces the label alone. */}
                <div aria-hidden="true" className="flex items-center gap-2.5">
                    <LaunchstackMark size={32} />
                    <span className="text-[17px] font-bold tracking-[-0.01em]">Launchstack</span>
                </div>
                {status}
            </div>
        </div>
    );
}
