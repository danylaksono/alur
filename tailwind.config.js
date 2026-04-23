/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "oklch(0.98 0.01 220)",
        foreground: "oklch(0.2 0.02 220)",
        primary: {
          DEFAULT: "oklch(0.6 0.15 250)",
          foreground: "oklch(0.98 0.01 220)",
        },
        secondary: {
          DEFAULT: "oklch(0.7 0.12 280)",
          foreground: "oklch(0.2 0.02 220)",
        },
        muted: "oklch(0.9 0.01 220)",
        border: "oklch(0.85 0.01 220)",
      },
      fontFamily: {
        sans: ['Figtree', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
