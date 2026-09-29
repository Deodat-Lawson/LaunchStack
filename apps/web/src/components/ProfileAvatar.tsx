"use client";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { profileInitials } from "~/lib/profile/resolve";
import { cn } from "~/lib/utils";

/**
 * A person's photo, or their initials on the brand colour when they have
 * none (or while it loads). Size comes from `className` (`size-8` default);
 * a caller that changes the size sets the initials' text size through
 * `fallbackClassName`.
 */
export function ProfileAvatar({
    name,
    email,
    src,
    className,
    fallbackClassName,
}: {
    name: string | null | undefined;
    email?: string | null;
    src: string | null | undefined;
    className?: string;
    fallbackClassName?: string;
}) {
    return (
        <Avatar className={cn("size-8", className)}>
            {src ? <AvatarImage src={src} alt="" className="object-cover" /> : null}
            <AvatarFallback
                className={cn(
                    "bg-brand text-brand-fg border-none text-xs font-semibold",
                    fallbackClassName
                )}
            >
                {profileInitials(name, email)}
            </AvatarFallback>
        </Avatar>
    );
}
