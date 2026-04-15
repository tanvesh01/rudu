/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F2F1ED",
        surface: "#F7F7F3",
        canvasDark: "rgb(230, 228, 221)",
        ink: {
          50: "#fafafa",
          100: "#f4f4f5",
          200: "#e4e4e7",
          300: "#d4d4d8",
          500: "#71717a",
          600: "#52525b",
          900: "#18181b",
        },
        brand: {
          500: "#27272a",
          600: "#18181b",
        },
        danger: {
          600: "#b91c1c",
        },
      },
      boxShadow: {
        dialog: "0 24px 80px rgba(15, 23, 42, 0.24)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "sans-serif",
        ],
        mono: [
          '"Geist Mono"',
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
