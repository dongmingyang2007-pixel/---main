import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1A1B1F",
        surf: "#F5F6F8",
        electric: "#1F8AFA",
        mint: "#00A885",
        amber: "#F6A609",
      },
    },
  },
  plugins: [],
};

export default config;
