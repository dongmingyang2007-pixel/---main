const DEFAULT_LOCAL_API_PORT = "8000";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOCAL_BIND_HOSTS = new Set(["0.0.0.0", "::"]);

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}

export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

  if (typeof window === "undefined") {
    return trimTrailingSlash(configured || `http://localhost:${DEFAULT_LOCAL_API_PORT}`);
  }

  const current = new URL(window.location.href);
  const fallback = `${current.protocol}//${current.hostname}:${DEFAULT_LOCAL_API_PORT}`;
  if (!configured) {
    return trimTrailingSlash(fallback);
  }

  try {
    const configuredUrl = new URL(configured);
    if (LOCAL_BIND_HOSTS.has(configuredUrl.hostname)) {
      configuredUrl.hostname = isLoopbackHost(current.hostname) ? current.hostname : "localhost";
      return trimTrailingSlash(configuredUrl.toString());
    }
    if (isLoopbackHost(current.hostname) && isLoopbackHost(configuredUrl.hostname) && current.hostname !== configuredUrl.hostname) {
      configuredUrl.hostname = current.hostname;
      return trimTrailingSlash(configuredUrl.toString());
    }
  } catch {
    return trimTrailingSlash(configured);
  }

  return trimTrailingSlash(configured);
}

export function getApiHttpBaseUrl(): string {
  if (typeof window !== "undefined") {
    return "";
  }
  return getApiBaseUrl();
}

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "铭润科技";
