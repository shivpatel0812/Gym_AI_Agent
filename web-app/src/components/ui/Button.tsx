'use client';

import { ReactNode, ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ai';
  loading?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export default function Button({
  variant = 'primary',
  loading = false,
  icon,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const baseClasses = "px-5 py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed";

  const variantClasses = {
    primary: "bg-[#FF6B35] text-white hover:bg-[#E85A2A] shadow-sm",
    secondary: "border border-[#2A2D35] bg-[#161A22] text-white hover:bg-[#1C1C1E]",
    danger: "bg-[#EF4444] text-white hover:bg-[#DC2626]",
    ai: "border border-[#5EEAD4]/40 bg-[#5EEAD4]/10 text-[#5EEAD4] hover:bg-[#5EEAD4]/15 shadow-ai",
  };

  return (
    <button
      className={clsx(baseClasses, variantClasses[variant], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <div className="animate-spin h-5 w-5 border-2 border-current border-t-transparent rounded-full" />
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
}
