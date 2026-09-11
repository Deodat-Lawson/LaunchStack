import {
    type InputHTMLAttributes,
    type ReactNode,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
    forwardRef,
} from "react";
import { cn } from "~/lib/utils";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

/**
 * Labeled form row: label, control, hint/error line. Successor to the
 * deprecated inline-style primitives' Field — same API, kit + tokens
 * underneath.
 */
export function Field({
    label,
    hint,
    error,
    children,
    inline,
}: {
    label: string;
    hint?: string;
    error?: string;
    children: ReactNode;
    inline?: boolean;
}) {
    return (
        <div className={cn("mb-4", inline && "flex items-center gap-3.5")}>
            <label
                className={cn(
                    "text-ink-2 block text-xs font-semibold",
                    inline ? "min-w-[160px]" : "mb-1.5"
                )}
            >
                {label}
            </label>
            <div className={cn(inline && "flex-1")}>
                {children}
                {hint && !error && (
                    <div className="text-ink-3 mt-1 text-[11px] leading-normal">{hint}</div>
                )}
                {error && <div className="text-danger mt-1 text-[11px]">{error}</div>}
            </div>
        </div>
    );
}

/** Thin aliases over the kit controls, kept for Field-based forms. */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
    function TextInput(props, ref) {
        return <Input ref={ref} {...props} />;
    }
);

export const TextArea = forwardRef<
    HTMLTextAreaElement,
    TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea(props, ref) {
    return <Textarea ref={ref} {...props} />;
});

/**
 * Styled native <select>. The kit's radix Select is the richer choice
 * for new work; this exists for plain-HTML forms that bind onChange.
 */
export const SelectInput = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
    function SelectInput({ className, children, ...props }, ref) {
        return (
            <select
                ref={ref}
                className={cn(
                    "border-line bg-panel text-ink w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors",
                    "focus:border-brand focus:ring-brand-glow focus:ring-2",
                    className
                )}
                {...props}
            >
                {children}
            </select>
        );
    }
);
