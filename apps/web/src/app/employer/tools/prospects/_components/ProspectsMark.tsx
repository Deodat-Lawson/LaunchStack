import { cn } from "~/lib/utils";
import { ProspectsMark } from "~/components/icons/prospects";

export { ProspectsMark };

export function ProspectsWordmark({ className }: { className?: string }) {
    return (
        <span className={cn("inline-flex items-center gap-2", className)}>
            <ProspectsMark size={15} tile />
            <span className="text-ink text-[13.5px] font-semibold tracking-[-0.02em]">
                Prospects
            </span>
        </span>
    );
}
