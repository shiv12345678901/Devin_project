/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand palette is driven at runtime by CSS variables on :root so the
        // Settings page can re-skin the whole app. Each var is a space-
        // separated RGB triplet so Tailwind alpha modifiers still work
        // (e.g. `bg-brand-500/20`).
        brand: {
          50:  'rgb(var(--brand-50)  / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
      },
      fontFamily: {
        // Inter on every platform; system font as a graceful fallback. The
        // -apple-system stack keeps San Francisco on Apple devices in the
        // unlikely case Inter fails to load.
        sans: [
          'Inter',
          'InterVariable',
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          'system-ui',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        // Display = same family at a tighter optical size. Inter Display is
        // the dedicated tighter-tracking variant Google Fonts ships.
        display: [
          '"Inter Display"',
          'Inter',
          'InterVariable',
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          '"SF Mono"',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        // Quiet, professional shadows — barely visible until you stack two
        // surfaces on top of each other. No 30%-opacity drama.
        glass:
          '0 1px 0 0 rgba(15, 23, 42, 0.02), 0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        'glass-lg':
          '0 1px 0 0 rgba(15, 23, 42, 0.02), 0 8px 24px -12px rgba(15, 23, 42, 0.08)',
        // Inner highlight used on selected swatches.
        'inset-ring': 'inset 0 0 0 1px rgba(255, 255, 255, 0.15)',
      },
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
    },
  },
  plugins: [],
}
