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
        "bg-[#1A1F3A] rounded-xl p-5 border",
        variant === "gradient" ? "border-[#6366F1]" : "border-[#374151]",
        "shadow-md hover:shadow-lg transition-shadow duration-200",
        className
      )}
    >
      {children}
    </div>
  );
}
