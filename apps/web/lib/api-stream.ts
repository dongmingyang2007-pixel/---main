// apps/web/lib/api-stream.ts
import { getApiHttpBaseUrl } from "./env";
import { buildStreamPostHeaders, handleStreamUnauthorized } from "./api";

export interface StreamEvent {
  event: string;
  data: Record<string, unknown>;
}

/**
 * SSE consumer for streaming chat responses.
 * Sends a POST request with full auth (CSRF token, workspace ID, credentials)
 * and yields parsed SSE events.
 */
export async function* apiStream(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const apiHttpBaseUrl = getApiHttpBaseUrl();
  const url = `${apiHttpBaseUrl}${path}`;

  const headers = await buildStreamPostHeaders(path);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials: "include",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw new Error(
      `Stream request failed: unable to reach ${url}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      handleStreamUnauthorized();
    }
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      /* ignore parse errors — keep raw text available via message */
    }
    throw Object.assign(new Error(`Stream request failed: ${response.status}`), {
      status: response.status,
      body: parsed,
    });
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let currentEvent = "message";
    let currentData = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        currentData = line.slice(6);
      } else if (line === "") {
        if (currentData) {
          try {
            yield { event: currentEvent, data: JSON.parse(currentData) };
          } catch {
            yield { event: currentEvent, data: { raw: currentData } };
          }
          currentEvent = "message";
          currentData = "";
        }
      }
    }
  }

  // Flush any remaining bytes in the buffer after the stream ends
  if (buffer.trim()) {
    const lines = buffer.split("\n");
    let currentEvent = "message";
    let currentData = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) currentEvent = line.slice(7).trim();
      else if (line.startsWith("data: ")) currentData = line.slice(6);
    }
    if (currentData) {
      try {
        yield { event: currentEvent, data: JSON.parse(currentData) };
      } catch {
        yield { event: currentEvent, data: { raw: currentData } };
      }
    }
  }
}
