import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#00c805",
          dark: "#009d04",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
