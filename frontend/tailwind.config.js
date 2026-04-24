/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f5f0ff',
          100: '#ebe0ff',
          200: '#d5bfff',
          300: '#b590ff',
          400: '#9a66ff',
          500: '#7c3aed',
          600: '#6d28d9',
          700: '#5b21b6',
          800: '#4c1d95',
          900: '#2e1065',
        },
      },
      fontFamily: {
        // San Francisco on Apple devices, Inter elsewhere. Matches the
        // "feels native on macOS/iOS" look without shipping SF Pro.
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          'Inter',
          'system-ui',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        // Gotham for titles with a Montserrat fallback (visually very close
        // geometric sans-serif, free to use).
        display: [
          'Gotham',
          '"Gotham HTF"',
          '"Gotham Pro"',
          'Montserrat',
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          'Inter',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        glass: '0 8px 32px 0 rgba(15, 23, 42, 0.12)',
        'glass-lg': '0 20px 60px -15px rgba(79, 70, 229, 0.25)',
      },
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
    },
  },
  plugins: [],
}
