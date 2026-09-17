import { cn } from "~/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="skeleton"
            className={cn(
                "bg-panel-2 animate-pulse rounded-md motion-reduce:animate-none",
                className
            )}
            {...props}
        />
    );
}

export { Skeleton };
