'use client';

import { ReactNode, ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
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
  const baseClasses = "px-6 py-3 rounded-xl font-semibold text-base flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed";

  const variantClasses = {
    primary: "bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white hover:shadow-lg shadow-md",
    secondary: "border-2 border-[#6366F1] text-[#6366F1] hover:bg-[#6366F1]/10",
    danger: "bg-[#EF4444] text-white hover:bg-[#DC2626]",
  };

  return (
    <button
      className={clsx(baseClasses, variantClasses[variant], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
}
