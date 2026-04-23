"use client";

import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
} from "react";

/** Full-page shell for pages using the Launchstack theme. Keeps a readable
 *  max-width column and applies OKLCH background. */
export function PageShell({
  children,
  wide = false,
  className,
  style,
}: {
  children: ReactNode;
  wide?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        background: "var(--bg)",
        color: "var(--ink)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      <main
        style={{
          maxWidth: wide ? 1200 : 840,
          width: "100%",
          margin: "0 auto",
          padding: "32px 24px 80px",
          flex: 1,
        }}
      >
        {children}
      </main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
        marginBottom: 28,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <div
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "var(--ink-3)",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {eyebrow}
          </div>
        )}
        <h1
          className="serif"
          style={{
            fontSize: 34,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
            margin: 0,
          }}
        >
          {title}
        </h1>
        {description && (
          <div
            style={{
              fontSize: 14,
              color: "var(--ink-3)",
              marginTop: 6,
              lineHeight: 1.55,
              maxWidth: 640,
            }}
          >
            {description}
          </div>
        )}
      </div>
      {actions && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div>
      )}
    </div>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ marginBottom: 32 }}>
      {title && (
        <div style={{ marginBottom: 16 }}>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--ink)",
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h2>
          {description && (
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-3)",
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              {description}
            </div>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({
  children,
  padding = 20,
  style,
}: {
  children: ReactNode;
  padding?: number | string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  inline?: boolean;
}

export function Field({ label, hint, error, children, inline }: FieldProps) {
  return (
    <div
      style={{
        display: inline ? "flex" : "block",
        alignItems: inline ? "center" : undefined,
        gap: inline ? 14 : undefined,
        marginBottom: 16,
      }}
    >
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--ink-2)",
          marginBottom: inline ? 0 : 6,
          minWidth: inline ? 160 : undefined,
        }}
      >
        {label}
      </label>
      <div style={{ flex: inline ? 1 : undefined }}>
        {children}
        {hint && !error && (
          <div
            style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.5 }}
          >
            {hint}
          </div>
        )}
        {error && (
          <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function TextInput({ style, ...props }, ref) {
  return (
    <input
      ref={ref}
      {...props}
      style={{
        width: "100%",
        padding: "9px 12px",
        borderRadius: 9,
        border: "1px solid var(--line)",
        background: "var(--panel)",
        fontSize: 14,
        color: "var(--ink)",
        outline: "none",
        transition: "border-color 120ms, box-shadow 120ms",
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-glow)";
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "var(--line)";
        e.currentTarget.style.boxShadow = "none";
        props.onBlur?.(e);
      }}
    />
  );
});

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ style, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      {...props}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 9,
        border: "1px solid var(--line)",
        background: "var(--panel)",
        fontSize: 14,
        color: "var(--ink)",
        outline: "none",
        resize: "vertical",
        minHeight: 100,
        fontFamily: "inherit",
        lineHeight: 1.55,
        transition: "border-color 120ms, box-shadow 120ms",
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-glow)";
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "var(--line)";
        e.currentTarget.style.boxShadow = "none";
        props.onBlur?.(e);
      }}
    />
  );
});

export const SelectInput = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function SelectInput({ style, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      {...props}
      style={{
        width: "100%",
        padding: "9px 12px",
        borderRadius: 9,
        border: "1px solid var(--line)",
        background: "var(--panel)",
        fontSize: 14,
        color: "var(--ink)",
        outline: "none",
        fontFamily: "inherit",
        ...style,
      }}
    >
      {children}
    </select>
  );
});

export interface PrimaryButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}

export const Button = forwardRef<HTMLButtonElement, PrimaryButtonProps>(
  function Button({ variant = "primary", style, children, ...props }, ref) {
    const base: CSSProperties = {
      fontSize: 13,
      fontWeight: 600,
      padding: "8px 14px",
      borderRadius: 8,
      cursor: props.disabled ? "not-allowed" : "pointer",
      transition: "background 120ms, border-color 120ms, transform 80ms",
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
    };
    const variants: Record<NonNullable<PrimaryButtonProps["variant"]>, CSSProperties> = {
      primary: {
        background: props.disabled ? "var(--line)" : "var(--accent)",
        color: props.disabled ? "var(--ink-3)" : "white",
        boxShadow: props.disabled ? "none" : "0 1px 4px var(--accent-glow)",
      },
      secondary: {
        background: "var(--panel)",
        border: "1px solid var(--line)",
        color: "var(--ink-2)",
      },
      ghost: {
        background: "transparent",
        color: "var(--ink-2)",
      },
      danger: {
        background: "transparent",
        border: "1px solid var(--line)",
        color: "var(--danger)",
      },
    };
    return (
      <button
        ref={ref}
        {...props}
        style={{ ...base, ...variants[variant], ...style }}
      >
        {children}
      </button>
    );
  },
);

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "ok" | "danger" | "warn";
}) {
  const toneStyles: Record<string, CSSProperties> = {
    neutral: { background: "var(--line-2)", color: "var(--ink-2)" },
    accent: { background: "var(--accent-soft)", color: "var(--accent-ink)" },
    ok: { background: "oklch(0.95 0.05 155)", color: "oklch(0.4 0.14 155)" },
    danger: { background: "oklch(0.95 0.05 25)", color: "var(--danger)" },
    warn: { background: "oklch(0.95 0.08 70)", color: "oklch(0.45 0.13 50)" },
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        ...toneStyles[tone],
      }}
    >
      {children}
    </span>
  );
}
