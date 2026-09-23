import type { ComponentType, CSSProperties } from "react";

/**
 * The props every icon in the app is rendered with — lucide-react glyphs
 * and the brand marks in `./brand` alike — so a registry can hold either.
 */
export interface IconProps {
    size?: number;
    style?: CSSProperties;
    className?: string;
}

export type IconComponent = ComponentType<IconProps>;
