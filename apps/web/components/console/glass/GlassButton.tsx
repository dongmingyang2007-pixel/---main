import { type ButtonHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";

type GlassButtonVariant = "primary" | "secondary" | "ghost";

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: GlassButtonVariant;
  children: ReactNode;
}

const variantStyles: Record<GlassButtonVariant, React.CSSProperties> = {
  primary: {
    background: "var(--console-accent-gradient)",
    color: "#ffffff",
    border: "none",
    boxShadow: "var(--console-shadow-primary)",
  },
  secondary: {
    background: "rgba(255,255,255,0.6)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    color: "var(--console-text-primary)",
    border: "1px solid rgba(0,0,0,0.08)",
  },
  ghost: {
    background: "transparent",
    color: "var(--console-accent)",
    border: "1px solid rgba(99,102,241,0.3)",
  },
};

export function GlassButton({
  variant = "primary",
  children,
  className,
  style,
  ...props
}: GlassButtonProps) {
  return (
    <button
      className={clsx("glass-button", `glass-button--${variant}`, className)}
      style={{
        borderRadius: "var(--console-radius-md)",
        padding: "9px 20px",
        fontWeight: 600,
        fontSize: "12px",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        transition: "filter 100ms",
        ...variantStyles[variant],
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}
