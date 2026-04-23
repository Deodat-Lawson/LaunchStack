"use client";

import React from "react";

interface LaunchstackLogoProps {
  size?: number;
  style?: React.CSSProperties;
  title?: string;
}

/**
 * Launchstack mark — stylized "LS" glyph in purple gradient on a rounded
 * diamond tile. Used as the app-wide logo; `size` drives the square edge
 * length. The mark scales visually 0.5-1x without losing structure.
 */
export function LaunchstackMark({ size = 28, style, title }: LaunchstackLogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={title ? "img" : "presentation"}
      aria-label={title}
      style={{ display: "block", flexShrink: 0, ...style }}
    >
      <defs>
        <linearGradient id="ls-mark-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.55 0.2 295)" />
          <stop offset="55%" stopColor="oklch(0.4 0.2 290)" />
          <stop offset="100%" stopColor="oklch(0.24 0.13 285)" />
        </linearGradient>
      </defs>
      <rect
        x="4"
        y="4"
        width="56"
        height="56"
        rx="10"
        transform="rotate(-6 32 32)"
        fill="url(#ls-mark-fill)"
      />
      {/* "L" stroke */}
      <path
        d="M18 17 L18 47 L32 47"
        stroke="white"
        strokeWidth="5"
        strokeLinecap="square"
        fill="none"
      />
      {/* "S" stroke — stylized Z/S hybrid matching the brand mark */}
      <path
        d="M46 18 L30 18 L30 32 L46 32 L46 46 L30 46"
        stroke="white"
        strokeWidth="5"
        strokeLinecap="square"
        strokeLinejoin="miter"
        fill="none"
      />
      {/* accent dot under the glyph */}
      <circle cx="18" cy="54" r="2.4" fill="white" opacity="0.85" />
    </svg>
  );
}

interface LaunchstackLockupProps {
  markSize?: number;
  textSize?: number;
  gap?: number;
  style?: React.CSSProperties;
}

/** Horizontal lockup: mark + "Launchstack" wordmark. */
export function LaunchstackLockup({
  markSize = 22,
  textSize = 14,
  gap = 9,
  style,
}: LaunchstackLockupProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
        ...style,
      }}
    >
      <LaunchstackMark size={markSize} title="Launchstack" />
      <span
        style={{
          fontSize: textSize,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          color: "inherit",
        }}
      >
        Launchstack
      </span>
    </span>
  );
}
