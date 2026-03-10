export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id: string;
  };
};

export type Paginated<T> = {
  items: T[];
  total?: number;
};

export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "canceled";

export type ModelAlias = "prod" | "staging" | "dev";

export type DemoInferResponse = {
  request_id: string;
  task: string;
  latency_ms: number;
  outputs: {
    text: string;
    boxes?: Array<{ x: number; y: number; w: number; h: number; label: string; score: number }>;
  };
  ui_cards: {
    case_display_text: string;
    tts_text: string;
    status_icons: string[];
  };
};

export type DemoPresignResponse = {
  request_id: string;
  upload_id: string;
  put_url: string;
  headers: Record<string, string>;
};
