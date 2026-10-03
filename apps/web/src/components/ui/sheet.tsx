"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * Where sheets mount. A Studio tool's tab provides its own element, so a
 * sheet opened from a tool in half the screen covers that tool — not the
 * chat in the column beside it. Unset, sheets mount on the body as usual.
 *
 * A sheet scoped to a tab is not modal for the page: the chat beside it
 * keeps working, and clicking or typing there leaves the sheet open. Inside
 * the tab it behaves as before — a dimmed backdrop that closes it on click.
 */
const SheetContainerContext = React.createContext<HTMLElement | null>(null);

function SheetContainerProvider({
    container,
    children,
}: {
    container: HTMLElement | null;
    children: React.ReactNode;
}) {
    return (
        <SheetContainerContext.Provider value={container}>
            {children}
        </SheetContainerContext.Provider>
    );
}

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
    const container = React.useContext(SheetContainerContext);
    return <SheetPrimitive.Root data-slot="sheet" {...props} modal={props.modal ?? !container} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
    return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
    return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
    const container = React.useContext(SheetContainerContext);
    return (
        <SheetPrimitive.Portal
            data-slot="sheet-portal"
            container={container ?? undefined}
            {...props}
        />
    );
}

function SheetOverlay({
    className,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
    return (
        <SheetPrimitive.Overlay
            data-slot="sheet-overlay"
            className={cn(
                "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
                className
            )}
            {...props}
        />
    );
}

function SheetContent({
    className,
    children,
    side = "right",
    onInteractOutside,
    onEscapeKeyDown,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
    side?: "top" | "right" | "bottom" | "left";
}) {
    const container = React.useContext(SheetContainerContext);
    return (
        <SheetPortal>
            {container ? (
                // Not modal, so Radix draws no overlay; this one dims the tab
                // only, and a click on it is a click outside the sheet.
                <div
                    data-slot="sheet-overlay"
                    aria-hidden
                    className="absolute inset-0 z-50 bg-black/50"
                />
            ) : (
                <SheetOverlay />
            )}
            <SheetPrimitive.Content
                onInteractOutside={event => {
                    // Clicks and focus in another column belong to that column.
                    if (container && !container.contains(event.target as Node)) {
                        event.preventDefault();
                    }
                    onInteractOutside?.(event);
                }}
                onEscapeKeyDown={event => {
                    // Escape pressed in the chat beside the tab is the chat's.
                    if (container && !container.contains(document.activeElement)) {
                        event.preventDefault();
                    }
                    onEscapeKeyDown?.(event);
                }}
                data-slot="sheet-content"
                className={cn(
                    "bg-surface data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
                    side === "right" &&
                        "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
                    side === "left" &&
                        "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
                    side === "top" &&
                        "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b",
                    side === "bottom" &&
                        "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t",
                    className
                )}
                {...props}
            >
                {children}
                <SheetPrimitive.Close className="ring-offset-background focus:ring-brand data-[state=open]:bg-panel-2 rounded-xs focus:outline-hidden absolute right-4 top-4 opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 disabled:pointer-events-none">
                    <XIcon className="size-4" />
                    <span className="sr-only">Close</span>
                </SheetPrimitive.Close>
            </SheetPrimitive.Content>
        </SheetPortal>
    );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sheet-header"
            className={cn("flex flex-col gap-1.5 p-4", className)}
            {...props}
        />
    );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sheet-footer"
            className={cn("mt-auto flex flex-col gap-2 p-4", className)}
            {...props}
        />
    );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
    return (
        <SheetPrimitive.Title
            data-slot="sheet-title"
            className={cn("text-ink font-semibold", className)}
            {...props}
        />
    );
}

function SheetDescription({
    className,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
    return (
        <SheetPrimitive.Description
            data-slot="sheet-description"
            className={cn("text-ink-3 text-sm", className)}
            {...props}
        />
    );
}

export {
    Sheet,
    SheetContainerProvider,
    SheetTrigger,
    SheetClose,
    SheetContent,
    SheetHeader,
    SheetFooter,
    SheetTitle,
    SheetDescription,
};
