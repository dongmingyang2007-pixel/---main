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
        brand: "#0f76ff",
        "brand-strong": "#0a4ed1",
        accent: "#19d6bf",
      },
      maxWidth: {
        site: "1120px",
      },
      borderRadius: {
        panel: "30px",
        card: "20px",
      },
      screens: {
        tablet: "768px",
        ipad: "1024px",
      },
    },
  },
  plugins: [],
};

export default config;
