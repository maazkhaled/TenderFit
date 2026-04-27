import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Inter",
          "sans-serif",
        ],
      },
      colors: {
        ink: {
          DEFAULT: "#0a0a0a",
          soft: "#262626",
          muted: "#525252",
        },
      },
    },
  },
  plugins: [],
};

export default config;
