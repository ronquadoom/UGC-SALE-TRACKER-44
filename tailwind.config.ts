import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#070a10",
          900: "#0b0f17",
          850: "#0f141f",
          800: "#131a28",
          700: "#1b2435",
          600: "#26324a",
        },
        accent: {
          DEFAULT: "#22d3ee",
          dim: "#0e7490",
        },
        profit: "#34d399",
        danger: "#f87171",
        warn: "#fbbf24",
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      keyframes: {
        pulseSoft: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        pulseSoft: "pulseSoft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
