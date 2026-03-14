import { NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

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

function isSameOriginEmbeddablePath(pathname: string): boolean {
  return pathname === "/product-viewer.html";
}

function isProtectedConsolePath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

function buildCsp(allowSameOriginFrame: boolean, scriptSrc: string): string {
  const apiOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_API_BASE_URL) || "'self'";
  const assetOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_ASSET_ORIGIN);
  const connectSrc = ["'self'", "blob:", apiOrigin, assetOrigin].filter(Boolean).join(" ");
  const assetSrc = ["'self'", "data:", "blob:", apiOrigin, assetOrigin].filter(Boolean).join(" ");
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
  const { pathname } = request.nextUrl;
  const allowSameOriginFrame = isSameOriginEmbeddablePath(pathname);

  // Auth check — strip locale prefix so /en/app/* is also protected
  const strippedPath = pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  if (isProtectedConsolePath(strippedPath) && !request.cookies.get("access_token")?.value) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  const isLocalHost = request.nextUrl.hostname === "localhost" || request.nextUrl.hostname === "127.0.0.1";
  const isLocalStack = process.env.QIHANG_LOCAL_STACK === "true";
  const useNonceCsp = process.env.NODE_ENV === "production" && !isLocalHost && !isLocalStack;
  let nonce: string | null = null;
  let response: NextResponse;

  if (isPageRoute(pathname)) {
    // Locale detection, prefix rewriting, and cookie handling
    response = intlMiddleware(request) as NextResponse;
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
