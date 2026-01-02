/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0A0E27',
        'card-bg': '#1A1F3A',
        'accent-primary': '#6366F1',
        'accent-secondary': '#8B5CF6',
        success: '#10B981',
        danger: '#EF4444',
        warning: '#F59E0B',
        'text-primary': '#F9FAFB',
        'text-secondary': '#9CA3AF',
        border: '#374151',
      },
      spacing: {
        'xs': '0.25rem',
        'sm': '0.5rem',
        'md': '0.75rem',
        'lg': '1rem',
        'xl': '1.5rem',
        '2xl': '2rem',
        '3xl': '3rem',
      },
      borderRadius: {
        'sm': '0.5rem',
        'md': '0.75rem',
        'lg': '1rem',
        'xl': '1.5rem',
      },
      boxShadow: {
        'sm': '0 2px 4px rgba(99, 102, 241, 0.1)',
        'md': '0 4px 8px rgba(99, 102, 241, 0.15)',
        'lg': '0 8px 16px rgba(99, 102, 241, 0.2)',
        'xl': '0 12px 24px rgba(99, 102, 241, 0.25)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}
