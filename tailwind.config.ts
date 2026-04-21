import type { Config } from "tailwindcss";

// Forme design tokens.
// Source of truth: DESIGN.md.
// If you change a token here, update DESIGN.md in the same commit.
export default {
  content: [
    "./index.html",
    "./src/renderer/**/*.{ts,tsx,html}",
    "./src/shared/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Canvas (DESIGN.md §2)
        "bg-canvas": "#F5EFE7",
        "bg-surface": "#FFFFFF",
        "bg-overlay": "rgba(26,26,26,0.50)",

        // Text
        "text-primary": "#1A1A1A",
        "text-secondary": "#5C5853",
        "text-tertiary": "#9B958E",
        "text-inverse": "#FEFCF8",

        // Accent (rust)
        accent: {
          DEFAULT: "#C96E4E",
          hover: "#B85942",
          pressed: "#A64733",
          muted: "#E8C4B3",
          bg: "#FCF1EC",
        },

        // Borders
        "border-default": "#E5DFD5",
        "border-strong": "#D4CBB8",

        // Semantic
        success: {
          DEFAULT: "#4A7C59",
          bg: "#EEF3EE",
        },
        warning: {
          DEFAULT: "#C9904E",
          bg: "#FAF3E8",
        },
        error: {
          DEFAULT: "#B84545",
          bg: "#F5E8E8",
        },
        info: {
          DEFAULT: "#5C7A9E",
          bg: "#E8EEF3",
        },
      },
      fontFamily: {
        display: [
          "Fraunces",
          "Playfair Display",
          "ui-serif",
          "Georgia",
          "serif",
        ],
        sans: ["Inter", "-apple-system", "system-ui", "sans-serif"],
        devanagari: ["Mukta", "Tiro Devanagari Hindi", "sans-serif"],
        mono: ["SF Mono", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "display-xl": ["3.5rem", { lineHeight: "1.05", fontWeight: "800" }],
        "display-lg": ["2.5rem", { lineHeight: "1.10", fontWeight: "700" }],
        "display-md": ["1.75rem", { lineHeight: "1.20", fontWeight: "700" }],
        "title-lg": ["1.375rem", { lineHeight: "1.25", fontWeight: "700" }],
        "title-md": ["1.125rem", { lineHeight: "1.30", fontWeight: "600" }],
        "title-sm": ["0.875rem", { lineHeight: "1.35", fontWeight: "600" }],
        body: ["0.875rem", { lineHeight: "1.50", fontWeight: "400" }],
        caption: ["0.75rem", { lineHeight: "1.40", fontWeight: "500" }],
        "label-caps": [
          "0.6875rem",
          {
            lineHeight: "1.20",
            fontWeight: "600",
            letterSpacing: "0.08em",
          },
        ],
        mono: ["0.8125rem", { lineHeight: "1.45", fontWeight: "400" }],
      },
      spacing: {
        // DESIGN.md §5
        0: "0",
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        5: "20px",
        6: "24px",
        8: "32px",
        10: "40px",
        12: "48px",
        16: "64px",
        24: "96px",
        32: "128px",
      },
      borderRadius: {
        none: "0",
        sm: "4px",
        md: "6px",
        lg: "8px",
        xl: "12px",
        full: "9999px",
      },
      boxShadow: {
        none: "none",
        sm: "0 1px 2px rgba(26,26,26,0.04)",
        md: "0 2px 8px rgba(26,26,26,0.06)",
        lg: "0 4px 24px rgba(26,26,26,0.08)",
        window: "0 8px 40px rgba(26,26,26,0.12)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        slow: "320ms",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(0.2, 0.0, 0.0, 1.0)",
        decelerate: "cubic-bezier(0.0, 0.0, 0.2, 1.0)",
        accelerate: "cubic-bezier(0.4, 0.0, 1.0, 1.0)",
      },
    },
  },
  plugins: [],
} satisfies Config;
