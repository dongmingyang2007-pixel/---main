import { NextRequest, NextResponse } from "next/server";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"] as const;

/** Routes that next-intl should handle (pages, not API/static/files). */
function isPageRoute(pathname: string): boolean {
  return !/^\/api\/|^\/_next\/|\./.test(pathname);
}

function normalizeOrigin(value?: string): string | null {
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

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.includes(hostname as (typeof LOOPBACK_HOSTS)[number]);
}

function expandLoopbackOrigins(origin: string | null): string[] {
  if (!origin) {
    return [];
  }

  const origins = [origin];
  try {
    const url = new URL(origin);
    if (isLoopbackHost(url.hostname)) {
      for (const loopbackHost of LOOPBACK_HOSTS) {
        if (loopbackHost === url.hostname) {
          continue;
        }
        url.hostname = loopbackHost;
        origins.push(`${url.protocol}//${url.host}`);
      }
    }
  } catch {
    return origins;
  }

  return Array.from(new Set(origins));
}

function isSameOriginEmbeddablePath(pathname: string): boolean {
  return pathname === "/product-viewer.html";
}

function isProtectedConsolePath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

function isEnglishPath(pathname: string): boolean {
  return pathname === "/en" || pathname.startsWith("/en/");
}

function getLocalePrefix(request: NextRequest): string {
  const rawPathname = new URL(request.url).pathname;
  return isEnglishPath(rawPathname) ? "/en" : "";
}

function buildCsp(allowSameOriginFrame: boolean, scriptSrc: string): string {
  const apiOrigins = expandLoopbackOrigins(normalizeOrigin(process.env.NEXT_PUBLIC_API_BASE_URL));
  const assetOrigins = expandLoopbackOrigins(normalizeOrigin(process.env.NEXT_PUBLIC_ASSET_ORIGIN));
  const connectSrc = ["'self'", "blob:", ...apiOrigins, ...assetOrigins].join(" ");
  const assetSrc = ["'self'", "data:", "blob:", ...apiOrigins, ...assetOrigins].join(" ");
  const frameAncestors = allowSameOriginFrame ? "'self'" : "'none'";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${assetSrc}`,
    `media-src ${assetSrc}`,
    `connect-src ${connectSrc}`,
    "font-src 'self' data:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const rawPathname = new URL(request.url).pathname;
  const allowSameOriginFrame = isSameOriginEmbeddablePath(rawPathname);

  // Auth check — strip locale prefix so /en/app/* is also protected
  const strippedPath = rawPathname.replace(/^\/(en|zh)(?=\/|$)/, "") || "/";
  if (isProtectedConsolePath(strippedPath) && !request.cookies.get("auth_state")?.value) {
    const loginUrl = new URL(`${getLocalePrefix(request)}/login`, request.url);
    return NextResponse.redirect(loginUrl);
  }

  const isLocalHost = request.nextUrl.hostname === "localhost" || request.nextUrl.hostname === "127.0.0.1";
  const isLocalStack = process.env.QIHANG_LOCAL_STACK === "true";
  const useNonceCsp = process.env.NODE_ENV === "production" && !isLocalHost && !isLocalStack;
  let nonce: string | null = null;
  let response: NextResponse;

  if (isPageRoute(rawPathname)) {
    response = NextResponse.next();
  } else {
    response = NextResponse.next();
  }

  // Generate nonce for CSP (production only)
  if (useNonceCsp) {
    nonce = btoa(crypto.randomUUID());
  }

  // Security headers — applied to every response (including intl redirects)
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", allowSameOriginFrame ? "SAMEORIGIN" : "DENY");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  );

  if (process.env.NODE_ENV === "production") {
    const scriptSrc = nonce
      ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
      : "'self' 'unsafe-inline'";
    response.headers.set(
      "Content-Security-Policy",
      buildCsp(allowSameOriginFrame, scriptSrc),
    );
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
