import { ReactNode } from "react";
import clsx from "clsx";

interface CardProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "gradient";
}

export default function Card({
  children,
  className,
  variant = "default",
}: CardProps) {
  return (
    <div
      className={clsx(
        "bg-[#161A22] rounded-2xl p-5 border",
        variant === "gradient" ? "border-[#FF6B35]/40" : "border-[#2A2D35]",
        "shadow-sm transition-shadow duration-200",
        className
      )}
    >
      {children}
    </div>
  );
}
