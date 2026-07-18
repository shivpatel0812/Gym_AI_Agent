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
        background: '#0B0C10',
        sidebar: '#0B0C10',
        'card-bg': '#161A22',
        'accent-primary': '#FF6B35',
        'accent-secondary': '#E85A2A',
        'accent-ai': '#5EEAD4',
        success: '#5EEAD4',
        danger: '#EF4444',
        warning: '#F5C542',
        'text-primary': '#FFFFFF',
        'text-secondary': '#8E8E93',
        border: '#2A2D35',
        surface: '#1C1C1E',
      },
      fontFamily: {
        sans: [
          'DM Sans',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
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
        'xl': '1.25rem',
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(0, 0, 0, 0.3)',
        'md': '0 4px 12px rgba(0, 0, 0, 0.35)',
        'lg': '0 8px 24px rgba(0, 0, 0, 0.4)',
        'xl': '0 16px 40px rgba(0, 0, 0, 0.45)',
        'orange': '0 0 20px rgba(255, 107, 53, 0.25)',
        'ai': '0 0 16px rgba(94, 234, 212, 0.2)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}
