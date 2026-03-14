const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/how-it-works", destination: "/product", permanent: true },
      { source: "/en/how-it-works", destination: "/en/product", permanent: true },
      { source: "/docs", destination: "/support", permanent: true },
      { source: "/en/docs", destination: "/en/support", permanent: true },
      { source: "/contact", destination: "/support#contact", permanent: true },
      { source: "/en/contact", destination: "/en/support#contact", permanent: true },
    ];
  },
};

module.exports = withNextIntl(nextConfig);
