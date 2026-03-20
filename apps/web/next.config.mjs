import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();
const DEFAULT_LOCAL_API_ORIGINS = ["http://localhost:8000", "http://127.0.0.1:8000"];
const DEFAULT_LOCAL_ASSET_ORIGINS = ["http://localhost:9000", "http://127.0.0.1:9000"];
const BROWSER_LOOPBACK_HOSTS = ["localhost", "127.0.0.1"];
const LOCAL_BIND_HOSTS = new Set(["0.0.0.0", "::"]);

function normalizeOrigin(value) {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function expandLoopbackOrigins(origin) {
  if (!origin) {
    return [];
  }
  try {
    const url = new URL(origin);
    if (
      !BROWSER_LOOPBACK_HOSTS.includes(url.hostname) &&
      !LOCAL_BIND_HOSTS.has(url.hostname)
    ) {
      return [origin];
    }
    return BROWSER_LOOPBACK_HOSTS.map((hostname) => {
      const next = new URL(origin);
      next.hostname = hostname;
      return next.origin;
    });
  } catch {
    return [origin];
  }
}

function configuredOrigins(value, fallbackOrigins = []) {
  const normalized = normalizeOrigin(value);
  if (!normalized) {
    return fallbackOrigins;
  }
  return Array.from(new Set(expandLoopbackOrigins(normalized)));
}

function expandConnectOrigins(origins) {
  const expanded = new Set(origins);
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (url.protocol === "http:") {
        expanded.add(`ws://${url.host}`);
      } else if (url.protocol === "https:") {
        expanded.add(`wss://${url.host}`);
      }
    } catch {
      continue;
    }
  }
  return Array.from(expanded);
}

const apiOrigins = configuredOrigins(
  process.env.NEXT_PUBLIC_API_BASE_URL,
  DEFAULT_LOCAL_API_ORIGINS,
);
const internalApiOrigin =
  normalizeOrigin(process.env.INTERNAL_API_BASE_URL) ||
  normalizeOrigin(process.env.NEXT_PUBLIC_API_BASE_URL) ||
  DEFAULT_LOCAL_API_ORIGINS[0];
const assetOrigins = configuredOrigins(
  process.env.NEXT_PUBLIC_ASSET_ORIGIN,
  DEFAULT_LOCAL_ASSET_ORIGINS,
);
const connectOrigins = expandConnectOrigins([...apiOrigins, ...assetOrigins]);
const assetSources = ["'self'", "data:", "blob:", ...apiOrigins, ...assetOrigins].join(" ");
const connectSources = ["'self'", "blob:", ...connectOrigins].join(" ");
const consoleCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src ${assetSources}`,
  `media-src ${assetSources}`,
  `connect-src ${connectSources}`,
  "font-src 'self' data:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
      { source: "/zh", destination: "/", permanent: false },
      { source: "/zh/:path*", destination: "/:path*", permanent: false },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/zh" },
        { source: "/api/:path*", destination: `${internalApiOrigin}/api/:path*` },
        // Keep console routes locale-aware even when dynamic ids contain dots
        // such as qwen3.5-plus or deepseek-v3.2.
        { source: "/app/:path*", destination: "/zh/app/:path*" },
        {
          source: "/:path((?!en(?:/|$)|zh(?:/|$)|api(?:/|$)|_next(?:/|$)|favicon\\.ico$|.*\\..*).*)",
          destination: "/zh/:path",
        },
      ],
    };
  },
  async headers() {
    const consoleHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()",
      },
      { key: "Content-Security-Policy", value: consoleCsp },
    ];

    return [
      { source: "/app", headers: consoleHeaders },
      { source: "/app/:path*", headers: consoleHeaders },
      { source: "/en/app", headers: consoleHeaders },
      { source: "/en/app/:path*", headers: consoleHeaders },
    ];
  },
};

export default withNextIntl(nextConfig);
