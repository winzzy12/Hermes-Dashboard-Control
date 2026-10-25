/** Linear-inspired design tokens (hermes-dashboard.md §2) — change centrally here. */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "var(--c-bg)",
        surface: "var(--c-surface)",
        text: "var(--c-text)",
        muted: "var(--c-muted)",
        line: "var(--c-border)",
        accent: "var(--c-accent)",
        success: "var(--c-success)",
        warning: "var(--c-warning)",
        error: "var(--c-error)",
      },
      fontSize: {
        xxs: ["11px", "16px"],
      },
      borderRadius: {
        DEFAULT: "6px",
        lg: "8px",
        xl: "12px",
      },
    },
  },
  plugins: [],
};
