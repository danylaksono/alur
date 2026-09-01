/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "oklch(0.985 0.006 180)",
        foreground: "oklch(0.22 0.025 190)",
        primary: {
          DEFAULT: "oklch(0.47 0.09 185)",
          foreground: "oklch(0.985 0.006 180)",
        },
        secondary: {
          DEFAULT: "oklch(0.76 0.14 78)",
          foreground: "oklch(0.22 0.025 190)",
        },
        muted: "oklch(0.93 0.012 180)",
        border: "oklch(0.87 0.015 180)",
      },
      fontFamily: {
        sans: ['Figtree', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      // Mirrors the motion tokens in index.css so components can reach them as
      // utilities. Defined here rather than as arbitrary values so there is one
      // place to change a curve.
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
        drawer: 'var(--ease-drawer)',
      },
      transitionDuration: {
        press: 'var(--dur-press)',
        hover: 'var(--dur-hover)',
        pop: 'var(--dur-pop)',
        surface: 'var(--dur-surface)',
      },
    },
  },
  plugins: [],
}
