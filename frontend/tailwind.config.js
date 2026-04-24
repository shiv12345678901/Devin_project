/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Light, minimal sage-green accent. Not the neon mint,
        // not the emerald jewel — a soft fern that reads as calm.
        brand: {
          50: '#f3faf4',
          100: '#e4f3e7',
          200: '#c8e6cf',
          300: '#a0d1ac',
          400: '#73b583',
          500: '#4f9862',
          600: '#3d7c4e',
          700: '#316340',
          800: '#284f34',
          900: '#20402b',
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
        // Softer, tighter — no big purple halo.
        glass: '0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.08)',
        'glass-lg': '0 2px 4px 0 rgba(15, 23, 42, 0.04), 0 16px 40px -18px rgba(15, 23, 42, 0.12)',
      },
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
    },
  },
  plugins: [],
}
