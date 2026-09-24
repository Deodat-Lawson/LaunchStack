"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "~/lib/utils";

function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
    return (
        <SliderPrimitive.Root
            data-slot="slider"
            className={cn(
                "relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50",
                className
            )}
            {...props}
        >
            <SliderPrimitive.Track
                data-slot="slider-track"
                className="bg-line relative h-1.5 w-full grow overflow-hidden rounded-full"
            >
                <SliderPrimitive.Range
                    data-slot="slider-range"
                    className="bg-brand absolute h-full"
                />
            </SliderPrimitive.Track>
            {(props.value ?? props.defaultValue ?? [0]).map((_, index) => (
                <SliderPrimitive.Thumb
                    key={index}
                    data-slot="slider-thumb"
                    className="border-brand bg-panel focus-visible:ring-brand/50 block size-4 rounded-full border shadow-sm outline-none transition-[box-shadow] focus-visible:ring-[3px] disabled:pointer-events-none"
                />
            ))}
        </SliderPrimitive.Root>
    );
}

export { Slider };
