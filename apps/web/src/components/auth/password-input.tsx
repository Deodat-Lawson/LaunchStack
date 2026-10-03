"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { ArrowBigUp, Eye, EyeOff } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, "type">;

/**
 * Password field for the auth screens: a show/hide toggle, and a Caps Lock
 * warning while the field has focus — the two usual reasons a correct
 * password is typed wrong.
 *
 * The field goes back to hidden when its form submits, so a password manager
 * sees a password field at the moment it decides whether to offer saving.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
    function PasswordInput(
        { className, onKeyDown, onKeyUp, onBlur, "aria-describedby": describedBy, ...props },
        forwardedRef
    ) {
        const [visible, setVisible] = useState(false);
        const [capsLock, setCapsLock] = useState(false);
        const inputRef = useRef<HTMLInputElement | null>(null);
        const capsId = useId();

        const setRefs = (node: HTMLInputElement | null) => {
            inputRef.current = node;
            if (typeof forwardedRef === "function") forwardedRef(node);
            else if (forwardedRef) forwardedRef.current = node;
        };

        useEffect(() => {
            const form = inputRef.current?.form;
            if (!form) return;
            const hide = () => setVisible(false);
            form.addEventListener("submit", hide);
            return () => form.removeEventListener("submit", hide);
        }, []);

        const readCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
            // Autofill can dispatch key events without modifier state.
            if (typeof e.getModifierState === "function") {
                setCapsLock(e.getModifierState("CapsLock"));
            }
        };

        return (
            <div className="flex flex-col gap-1.5">
                <div className="relative">
                    <Input
                        ref={setRefs}
                        type={visible ? "text" : "password"}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        className={cn("pr-10", className)}
                        aria-describedby={
                            [describedBy, capsLock ? capsId : null].filter(Boolean).join(" ") ||
                            undefined
                        }
                        onKeyDown={e => {
                            readCapsLock(e);
                            onKeyDown?.(e);
                        }}
                        onKeyUp={e => {
                            readCapsLock(e);
                            onKeyUp?.(e);
                        }}
                        onBlur={e => {
                            setCapsLock(false);
                            onBlur?.(e);
                        }}
                        {...props}
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-ink-3 hover:text-ink absolute inset-y-0 right-0 h-9 w-9 hover:bg-transparent"
                        aria-label={visible ? "Hide password" : "Show password"}
                        aria-pressed={visible}
                        aria-controls={props.id}
                        disabled={props.disabled}
                        onClick={() => setVisible(v => !v)}
                    >
                        {visible ? <EyeOff /> : <Eye />}
                    </Button>
                </div>
                {capsLock && (
                    <p
                        id={capsId}
                        className="text-warn m-0 flex items-center gap-1 text-[11.5px] font-medium"
                    >
                        <ArrowBigUp className="size-3.5" aria-hidden />
                        Caps Lock is on
                    </p>
                )}
            </div>
        );
    }
);
