const AUTH_STATE_COOKIE = "auth_state";
const AUTH_STATE_MAX_AGE = 3600;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

function writeCookie(name: string, value: string, maxAge?: number): void {
  if (typeof document === "undefined") return;
  let cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (maxAge !== undefined) cookie += `; Max-Age=${maxAge}`;
  document.cookie = cookie;
}

function clearCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Path=/; Max-Age=0`;
}

export function isLoggedIn(): boolean {
  return readCookie(AUTH_STATE_COOKIE) === "1";
}

export function setAuthState(): void {
  writeCookie(AUTH_STATE_COOKIE, "1", AUTH_STATE_MAX_AGE);
}

export function clearAuthState(): void {
  clearCookie(AUTH_STATE_COOKIE);
}
