const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/how-it-works", destination: "/product", permanent: true },
      { source: "/docs", destination: "/support", permanent: true },
      { source: "/contact", destination: "/support#contact", permanent: true },
    ];
  },
};

module.exports = withNextIntl(nextConfig);
