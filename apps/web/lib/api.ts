import { API_BASE_URL } from "@/lib/env";

const WORKSPACE_COOKIE_NAME = "qihang_workspace_id";

let cachedCsrfToken: string | null = null;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const cookies = document.cookie.split(";").map((value) => value.trim());
  const match = cookies.find((value) => value.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
}

function clearCachedSecurityState(): void {
  cachedCsrfToken = null;
}

function isPublicMutation(path: string): boolean {
  return [
    "/api/v1/auth/login",
    "/api/v1/auth/register",
    "/api/v1/demo/presign",
    "/api/v1/demo/infer",
  ].includes(path);
}

async function ensureCsrfToken(): Promise<string> {
  if (cachedCsrfToken) {
    return cachedCsrfToken;
  }
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/csrf`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.csrf_token) {
    throw new Error(data?.error?.message || "无法获取安全令牌");
  }
  cachedCsrfToken = data.csrf_token as string;
  return cachedCsrfToken;
}

function buildHeaders(
  path: string,
  method: string,
  initialHeaders?: HeadersInit,
  contentType = "application/json",
  csrfToken?: string,
): Headers {
  const headers = new Headers(initialHeaders || {});
  if (contentType && !headers.has("Content-Type")) {
    headers.set("Content-Type", contentType);
  }
  const workspaceId = readCookie(WORKSPACE_COOKIE_NAME);
  if (workspaceId && !headers.has("X-Workspace-ID")) {
    headers.set("X-Workspace-ID", workspaceId);
  }
  if (csrfToken && !isPublicMutation(path) && ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  return headers;
}

async function parseResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      clearCachedSecurityState();
    }
    const errorMessage = data?.error?.message || `Request failed with status ${res.status}`;
    throw new Error(errorMessage);
  }
  return data as T;
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: { requireCsrf?: boolean; contentType?: string } = {},
): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const requireCsrf =
    options.requireCsrf ?? (!isPublicMutation(path) && ["POST", "PUT", "PATCH", "DELETE"].includes(method));
  const csrfToken = requireCsrf ? await ensureCsrfToken() : undefined;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: buildHeaders(path, method, init.headers, options.contentType, csrfToken),
    cache: "no-store",
  });
  return parseResponse<T>(res);
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return apiRequest<T>(path, init, { requireCsrf: false });
}

export async function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return apiRequest<T>(
    path,
    {
      method: "POST",
      ...init,
      body: body ? JSON.stringify(body) : undefined,
    },
    { requireCsrf: !isPublicMutation(path) },
  );
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(
    path,
    {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    },
    { requireCsrf: true },
  );
}

export async function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(
    path,
    {
      method: "DELETE",
    },
    { requireCsrf: true },
  );
}

export async function uploadToPresignedUrl(
  path: string,
  init: RequestInit,
  options: { authenticated?: boolean } = {},
): Promise<Response> {
  const { authenticated = false } = options;
  const method = (init.method || "PUT").toUpperCase();
  const isApiUrl = path.startsWith(API_BASE_URL);
  const headers = new Headers(init.headers || {});
  if (authenticated && isApiUrl) {
    const csrfToken = await ensureCsrfToken();
    const workspaceId = readCookie(WORKSPACE_COOKIE_NAME);
    headers.set("X-CSRF-Token", csrfToken);
    if (workspaceId) {
      headers.set("X-Workspace-ID", workspaceId);
    }
  }
  return fetch(path, {
    ...init,
    method,
    credentials: isApiUrl ? "include" : init.credentials,
    headers,
  });
}

export function persistWorkspaceId(workspaceId: string): void {
  writeCookie(WORKSPACE_COOKIE_NAME, workspaceId);
}

export function clearWorkspaceId(): void {
  writeCookie(WORKSPACE_COOKIE_NAME, "");
}

export async function apiPut<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return apiRequest<T>(
    path,
    {
      method: "PUT",
      ...init,
      body: body ? JSON.stringify(body) : undefined,
    },
    { requireCsrf: !isPublicMutation(path) },
  );
}
