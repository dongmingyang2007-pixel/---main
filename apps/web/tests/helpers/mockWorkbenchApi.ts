import type { Page, Route } from "@playwright/test";

const APP_ORIGIN = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100";
const CONFIGURED_API_ORIGIN = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const COOKIE_ORIGINS = expandLoopbackOrigins(APP_ORIGIN);

function alignLoopbackHost(origin: string, appOrigin: string): string {
  try {
    const apiUrl = new URL(origin);
    const appUrl = new URL(appOrigin);
    const isApiLoopback = apiUrl.hostname === "localhost" || apiUrl.hostname === "127.0.0.1";
    const isAppLoopback = appUrl.hostname === "localhost" || appUrl.hostname === "127.0.0.1";

    if (isApiLoopback && isAppLoopback && apiUrl.hostname !== appUrl.hostname) {
      apiUrl.hostname = appUrl.hostname;
      return apiUrl.origin;
    }
  } catch {
    return origin;
  }

  return origin;
}

function expandLoopbackOrigins(origin: string): string[] {
  try {
    const url = new URL(origin);
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return [origin];
    }
    const variants = ["localhost", "127.0.0.1"].map((hostname) => {
      const next = new URL(origin);
      next.hostname = hostname;
      return next.origin;
    });
    return Array.from(new Set(variants));
  } catch {
    return [origin];
  }
}

const API_ORIGINS = Array.from(
  new Set([CONFIGURED_API_ORIGIN, alignLoopbackHost(CONFIGURED_API_ORIGIN, APP_ORIGIN)]),
);

type Project = {
  id: string;
  name: string;
  description?: string;
  created_at: string;
};

type Dataset = {
  id: string;
  project_id: string;
  name: string;
  type: string;
  created_at: string;
};

type DatasetVersion = {
  id: string;
  dataset_id: string;
  version: number;
};

type Job = {
  id: string;
  project_id: string;
  dataset_version_id: string;
  recipe: string;
  status: "pending" | "running" | "succeeded" | "failed" | "canceled";
  created_at: string;
};

type Model = {
  id: string;
  project_id: string;
  name: string;
  task_type: string;
  created_at: string;
};

type ModelAlias = {
  alias: "prod" | "staging" | "dev";
  model_version_id: string;
};

type ModelVersion = {
  id: string;
  version: number;
};

type Conversation = {
  id: string;
  project_id: string;
  title: string;
  updated_at: string;
};

type PipelineConfigItem = {
  id: string;
  project_id: string;
  model_type: "llm" | "asr" | "tts" | "vision";
  model_id: string;
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type CatalogModel = {
  id: string;
  model_id: string;
  display_name: string;
  provider: string;
  provider_display?: string;
  category: "llm" | "asr" | "tts" | "vision";
  description: string;
  capabilities: string[];
  input_price: number;
  output_price: number;
  context_window: number;
  max_output: number;
  input_modalities?: string[];
  output_modalities?: string[];
  supports_function_calling?: boolean;
  supports_web_search?: boolean;
  supports_structured_output?: boolean;
  supports_cache?: boolean;
  batch_input_price?: number | null;
  batch_output_price?: number | null;
  cache_read_price?: number | null;
  cache_write_price?: number | null;
  price_unit?: string;
  price_note?: string | null;
};

type MemoryNode = {
  id: string;
  workspace_id: string;
  project_id: string;
  content: string;
  category: string;
  type: "permanent" | "temporary";
  source_conversation_id: string | null;
  parent_memory_id: string | null;
  position_x: number | null;
  position_y: number | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type ChatMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type MockDb = {
  workspaceId: string;
  projects: Project[];
  conversationsByProjectId: Record<string, Conversation[]>;
  messagesByConversationId: Record<string, ChatMessage[]>;
  datasets: Dataset[];
  datasetVersions: DatasetVersion[];
  jobs: Job[];
  models: Model[];
  modelAliasesById: Record<string, ModelAlias[]>;
  modelVersionsById: Record<string, ModelVersion[]>;
  pipelineConfigs: PipelineConfigItem[];
  modelCatalog: CatalogModel[];
  memoryNodesByProjectId: Record<string, MemoryNode[]>;
  counters: Record<string, number>;
};

export type MockWorkbenchHandle = {
  workspaceId: string;
  seedProjectId: string;
};

function nowIso(): string {
  return "2026-03-14T12:00:00.000Z";
}

function nextId(db: MockDb, prefix: string): string {
  db.counters[prefix] = (db.counters[prefix] || 0) + 1;
  return `${prefix}-${String(db.counters[prefix]).padStart(3, "0")}`;
}

function createMockDb(): MockDb {
  const workspaceId = "ws-playwright";
  const seedProjectId = "proj-seed";
  const seedDatasetId = "dataset-seed";
  const seedVersionId = "dsv-seed";
  const seedModelId = "model-seed";
  const seedModelVersionId = "model-version-seed";

  return {
    workspaceId,
    projects: [
      {
        id: seedProjectId,
        name: "Seed Console Project",
        description: "Default workspace project",
        created_at: nowIso(),
      },
    ],
    conversationsByProjectId: {
      [seedProjectId]: [],
    },
    messagesByConversationId: {},
    datasets: [
      {
        id: seedDatasetId,
        project_id: seedProjectId,
        name: "Seed Dataset",
        type: "images",
        created_at: nowIso(),
      },
    ],
    datasetVersions: [
      {
        id: seedVersionId,
        dataset_id: seedDatasetId,
        version: 1,
      },
    ],
    jobs: [
      {
        id: "job-seed",
        project_id: seedProjectId,
        dataset_version_id: seedVersionId,
        recipe: "baseline",
        status: "succeeded",
        created_at: nowIso(),
      },
    ],
    models: [
      {
        id: seedModelId,
        project_id: seedProjectId,
        name: "Seed Model",
        task_type: "general",
        created_at: nowIso(),
      },
    ],
    modelAliasesById: {
      [seedModelId]: [{ alias: "prod", model_version_id: seedModelVersionId }],
    },
    modelVersionsById: {
      [seedModelId]: [{ id: seedModelVersionId, version: 3 }],
    },
    pipelineConfigs: [
      {
        id: "pipe-llm-seed",
        project_id: seedProjectId,
        model_type: "llm",
        model_id: "qwen3.5-plus",
        config_json: {},
        created_at: nowIso(),
        updated_at: nowIso(),
      },
      {
        id: "pipe-asr-seed",
        project_id: seedProjectId,
        model_type: "asr",
        model_id: "paraformer-v2",
        config_json: {},
        created_at: nowIso(),
        updated_at: nowIso(),
      },
      {
        id: "pipe-tts-seed",
        project_id: seedProjectId,
        model_type: "tts",
        model_id: "cosyvoice",
        config_json: {},
        created_at: nowIso(),
        updated_at: nowIso(),
      },
    ],
    modelCatalog: [
      {
        id: "catalog-qwen3.5-plus",
        model_id: "qwen3.5-plus",
        display_name: "Qwen3.5-Plus",
        provider: "qwen",
        provider_display: "千问 · 阿里云",
        category: "llm",
        description: "均衡的旗舰级通用模型，支持视觉、函数调用和联网搜索。",
        capabilities: ["chat", "vision", "function_calling", "web_search"],
        input_price: 0.004,
        output_price: 0.012,
        context_window: 131072,
        max_output: 8192,
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        supports_function_calling: true,
        supports_web_search: true,
        supports_structured_output: true,
        supports_cache: true,
        batch_input_price: null,
        batch_output_price: null,
        cache_read_price: null,
        cache_write_price: null,
        price_unit: "tokens",
        price_note: null,
      },
      {
        id: "catalog-paraformer-v2",
        model_id: "paraformer-v2",
        display_name: "Paraformer-v2",
        provider: "alibaba",
        provider_display: "千问 · 阿里云",
        category: "asr",
        description: "实时语音识别模型，支持中英文混合输入。",
        capabilities: ["asr"],
        input_price: 0,
        output_price: 0,
        context_window: 0,
        max_output: 0,
        input_modalities: ["audio"],
        output_modalities: ["text"],
        supports_function_calling: false,
        supports_web_search: false,
        supports_structured_output: false,
        supports_cache: false,
        batch_input_price: null,
        batch_output_price: null,
        cache_read_price: null,
        cache_write_price: null,
        price_unit: "audio",
        price_note: "免费额度",
      },
      {
        id: "catalog-cosyvoice",
        model_id: "cosyvoice",
        display_name: "CosyVoice",
        provider: "alibaba",
        provider_display: "千问 · 阿里云",
        category: "tts",
        description: "自然风格语音合成模型，支持多音色和情绪表达。",
        capabilities: ["tts"],
        input_price: 0,
        output_price: 0,
        context_window: 0,
        max_output: 0,
        input_modalities: ["text"],
        output_modalities: ["audio"],
        supports_function_calling: false,
        supports_web_search: false,
        supports_structured_output: false,
        supports_cache: false,
        batch_input_price: null,
        batch_output_price: null,
        cache_read_price: null,
        cache_write_price: null,
        price_unit: "characters",
        price_note: "按字符计费",
      },
    ],
    memoryNodesByProjectId: {
      [seedProjectId]: [],
    },
    counters: {
      proj: 1,
      conv: 0,
      msg: 0,
      dataset: 1,
      dsv: 1,
      job: 1,
      model: 1,
      "model-version": 1,
      memory: 0,
    },
  };
}

async function fulfillJson(route: Route, payload: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function setAuthenticatedCookies(page: Page, workspaceId: string): Promise<void> {
  await page.context().addCookies(
    COOKIE_ORIGINS.flatMap((origin) => [
      {
        name: "auth_state",
        value: "1",
        url: origin,
        sameSite: "Lax" as const,
      },
      {
        name: "access_token",
        value: "playwright-access-token",
        url: origin,
        httpOnly: true,
        sameSite: "Lax" as const,
      },
      {
        name: "mingrun_workspace_id",
        value: workspaceId,
        url: origin,
        sameSite: "Lax" as const,
      },
    ]),
  );
}

function readJsonBody<T>(route: Route): T {
  const data = route.request().postDataJSON();
  return (data || {}) as T;
}

export async function installWorkbenchApiMock(
  page: Page,
  options: { authenticated?: boolean } = {},
): Promise<MockWorkbenchHandle> {
  const db = createMockDb();
  if (options.authenticated) {
    await setAuthenticatedCookies(page, db.workspaceId);
  }

  const handleApiRoute = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname, searchParams } = url;
    const method = request.method().toUpperCase();

    if (pathname === "/api/v1/auth/csrf" && method === "GET") {
      await fulfillJson(route, { csrf_token: "csrf-playwright-token" });
      return;
    }

    if (pathname === "/api/v1/auth/send-code" && method === "POST") {
      await fulfillJson(route, { ok: true, sent: true });
      return;
    }

    if (pathname === "/api/v1/auth/register" && method === "POST") {
      const body = readJsonBody<{ code?: string }>(route);
      if (!body.code) {
        await fulfillJson(route, { error: { message: "missing code" } }, 422);
        return;
      }
      await setAuthenticatedCookies(page, db.workspaceId);
      await fulfillJson(route, {
        workspace: { id: db.workspaceId },
        access_token_expires_in_seconds: 3600,
      });
      return;
    }

    if (pathname === "/api/v1/auth/login" && method === "POST") {
      await setAuthenticatedCookies(page, db.workspaceId);
      await fulfillJson(route, {
        workspace: { id: db.workspaceId },
        access_token_expires_in_seconds: 3600,
      });
      return;
    }

    if (pathname === "/api/v1/auth/reset-password" && method === "POST") {
      const body = readJsonBody<{ code?: string; password?: string }>(route);
      if (!body.code || !body.password) {
        await fulfillJson(route, { error: { message: "missing reset fields" } }, 422);
        return;
      }
      await fulfillJson(route, { ok: true });
      return;
    }

    if (pathname === "/api/v1/auth/logout" && method === "POST") {
      await fulfillJson(route, { ok: true });
      return;
    }

    if (pathname === "/api/v1/projects" && method === "GET") {
      await fulfillJson(route, { items: db.projects });
      return;
    }

    if (pathname === "/api/v1/projects" && method === "POST") {
      const body = readJsonBody<{ name?: string; description?: string }>(route);
      const project: Project = {
        id: nextId(db, "proj"),
        name: body.name || "Untitled project",
        description: body.description || "",
        created_at: nowIso(),
      };
      db.projects.unshift(project);
      await fulfillJson(route, project, 201);
      return;
    }

    const projectDetailMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
    if (projectDetailMatch && method === "GET") {
      const projectId = projectDetailMatch[1];
      const project = db.projects.find((item) => item.id === projectId);
      if (!project) {
        await fulfillJson(route, { error: { message: "project not found" } }, 404);
        return;
      }
      await fulfillJson(route, project);
      return;
    }

    if (pathname === "/api/v1/chat/conversations" && method === "GET") {
      const projectId = searchParams.get("project_id") || "";
      await fulfillJson(route, db.conversationsByProjectId[projectId] || []);
      return;
    }

    if (pathname === "/api/v1/chat/conversations" && method === "POST") {
      const body = readJsonBody<{ project_id?: string; title?: string }>(route);
      const projectId = body.project_id || db.projects[0]?.id || "";
      const conversation: Conversation = {
        id: nextId(db, "conv"),
        project_id: projectId,
        title: body.title || "New Conversation",
        updated_at: nowIso(),
      };
      db.conversationsByProjectId[projectId] = [
        conversation,
        ...(db.conversationsByProjectId[projectId] || []),
      ];
      db.messagesByConversationId[conversation.id] = [];
      await fulfillJson(route, conversation);
      return;
    }

    const conversationMessagesMatch = pathname.match(/^\/api\/v1\/chat\/conversations\/([^/]+)\/messages$/);
    if (conversationMessagesMatch && method === "GET") {
      const conversationId = conversationMessagesMatch[1];
      await fulfillJson(route, db.messagesByConversationId[conversationId] || []);
      return;
    }

    if (conversationMessagesMatch && method === "POST") {
      const conversationId = conversationMessagesMatch[1];
      const body = readJsonBody<{ content?: string }>(route);
      const now = nowIso();
      const userMessage: ChatMessage = {
        id: nextId(db, "msg"),
        conversation_id: conversationId,
        role: "user",
        content: body.content || "",
        created_at: now,
      };
      const assistantMessage: ChatMessage = {
        id: nextId(db, "msg"),
        conversation_id: conversationId,
        role: "assistant",
        content: "Mock assistant response",
        created_at: now,
      };
      db.messagesByConversationId[conversationId] = [
        ...(db.messagesByConversationId[conversationId] || []),
        userMessage,
        assistantMessage,
      ];
      await fulfillJson(route, assistantMessage);
      return;
    }

    if (pathname === "/api/v1/memory" && method === "GET") {
      const projectId = searchParams.get("project_id") || "";
      await fulfillJson(route, { nodes: db.memoryNodesByProjectId[projectId] || [], edges: [] });
      return;
    }

    if (pathname === "/api/v1/memory" && method === "POST") {
      const body = readJsonBody<{ project_id?: string; content?: string; category?: string }>(route);
      const projectId = body.project_id || db.projects[0]?.id || "";
      const node: MemoryNode = {
        id: nextId(db, "memory"),
        workspace_id: db.workspaceId,
        project_id: projectId,
        content: body.content || "",
        category: body.category || "",
        type: "permanent",
        source_conversation_id: null,
        parent_memory_id: null,
        position_x: null,
        position_y: null,
        metadata_json: {},
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      db.memoryNodesByProjectId[projectId] = [...(db.memoryNodesByProjectId[projectId] || []), node];
      await fulfillJson(route, node);
      return;
    }

    const projectStreamMatch = pathname.match(/^\/api\/v1\/memory\/([^/]+)\/stream$/);
    if (projectStreamMatch && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "",
      });
      return;
    }

    const conversationStreamMatch = pathname.match(/^\/api\/v1\/chat\/conversations\/([^/]+)\/memory-stream$/);
    if (conversationStreamMatch && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "",
      });
      return;
    }

    if (pathname === "/api/v1/datasets" && method === "GET") {
      const projectId = searchParams.get("project_id") || "";
      await fulfillJson(
        route,
        db.datasets.filter((dataset) => dataset.project_id === projectId),
      );
      return;
    }

    if (pathname === "/api/v1/datasets" && method === "POST") {
      const body = readJsonBody<{ project_id?: string; name?: string; type?: string }>(route);
      const dataset: Dataset = {
        id: nextId(db, "dataset"),
        project_id: body.project_id || db.projects[0]?.id || "",
        name: body.name || "Untitled dataset",
        type: body.type || "images",
        created_at: nowIso(),
      };
      db.datasets.unshift(dataset);
      db.datasetVersions.unshift({
        id: nextId(db, "dsv"),
        dataset_id: dataset.id,
        version: 1,
      });
      await fulfillJson(route, dataset, 201);
      return;
    }

    const datasetVersionMatch = pathname.match(/^\/api\/v1\/datasets\/([^/]+)\/versions$/);
    if (datasetVersionMatch && method === "GET") {
      const datasetId = datasetVersionMatch[1];
      await fulfillJson(
        route,
        db.datasetVersions.filter((version) => version.dataset_id === datasetId),
      );
      return;
    }

    if (pathname === "/api/v1/train/jobs" && method === "GET") {
      const projectId = searchParams.get("project_id") || "";
      await fulfillJson(
        route,
        { items: db.jobs.filter((job) => job.project_id === projectId) },
      );
      return;
    }

    if (pathname === "/api/v1/train/jobs" && method === "POST") {
      const body = readJsonBody<{ project_id?: string; dataset_version_id?: string; recipe?: string }>(route);
      const job: Job = {
        id: nextId(db, "job"),
        project_id: body.project_id || db.projects[0]?.id || "",
        dataset_version_id: body.dataset_version_id || db.datasetVersions[0]?.id || "",
        recipe: body.recipe || "mock",
        status: "pending",
        created_at: nowIso(),
      };
      db.jobs.unshift(job);
      await fulfillJson(route, job, 201);
      return;
    }

    if (pathname === "/api/v1/models" && method === "GET") {
      const projectId = searchParams.get("project_id") || "";
      await fulfillJson(
        route,
        { items: db.models.filter((model) => model.project_id === projectId) },
      );
      return;
    }

    if (pathname === "/api/v1/models" && method === "POST") {
      const body = readJsonBody<{ project_id?: string; name?: string; task_type?: string }>(route);
      const model: Model = {
        id: nextId(db, "model"),
        project_id: body.project_id || db.projects[0]?.id || "",
        name: body.name || "Untitled model",
        task_type: body.task_type || "general",
        created_at: nowIso(),
      };
      db.models.unshift(model);
      const versionId = nextId(db, "model-version");
      db.modelAliasesById[model.id] = [{ alias: "prod", model_version_id: versionId }];
      db.modelVersionsById[model.id] = [{ id: versionId, version: 1 }];
      await fulfillJson(route, model, 201);
      return;
    }

    if (pathname === "/api/v1/models/catalog" && method === "GET") {
      await fulfillJson(route, db.modelCatalog);
      return;
    }

    const modelCatalogDetailMatch = pathname.match(/^\/api\/v1\/models\/catalog\/([^/]+)$/);
    if (modelCatalogDetailMatch && method === "GET") {
      const modelId = modelCatalogDetailMatch[1];
      const model = db.modelCatalog.find((item) => item.model_id === modelId);
      if (!model) {
        await fulfillJson(route, { error: { message: "catalog model not found" } }, 404);
        return;
      }
      await fulfillJson(route, model);
      return;
    }

    if (pathname === "/api/v1/pipeline" && method === "GET") {
      const projectId = searchParams.get("project_id") || "";
      await fulfillJson(route, {
        items: db.pipelineConfigs.filter((item) => item.project_id === projectId),
      });
      return;
    }

    if (pathname === "/api/v1/pipeline" && method === "PATCH") {
      const body = readJsonBody<{
        project_id?: string;
        model_type?: "llm" | "asr" | "tts" | "vision";
        model_id?: string;
        config_json?: Record<string, unknown>;
      }>(route);
      const projectId = body.project_id || db.projects[0]?.id || "";
      const modelType = body.model_type || "llm";
      const current = db.pipelineConfigs.find(
        (item) => item.project_id === projectId && item.model_type === modelType,
      );
      if (current) {
        current.model_id = body.model_id || current.model_id;
        current.config_json = body.config_json || current.config_json;
        current.updated_at = nowIso();
        await fulfillJson(route, current);
        return;
      }
      const created: PipelineConfigItem = {
        id: `pipe-${modelType}-${nextId(db, "proj")}`,
        project_id: projectId,
        model_type: modelType,
        model_id: body.model_id || "",
        config_json: body.config_json || {},
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      db.pipelineConfigs.push(created);
      await fulfillJson(route, created);
      return;
    }

    const modelDetailMatch = pathname.match(/^\/api\/v1\/models\/([^/]+)$/);
    if (modelDetailMatch && method === "GET") {
      const modelId = modelDetailMatch[1];
      await fulfillJson(route, { aliases: db.modelAliasesById[modelId] || [] });
      return;
    }

    const modelVersionMatch = pathname.match(/^\/api\/v1\/models\/([^/]+)\/versions$/);
    if (modelVersionMatch && method === "GET") {
      const modelId = modelVersionMatch[1];
      await fulfillJson(route, { items: db.modelVersionsById[modelId] || [] });
      return;
    }

    await fulfillJson(
      route,
      { error: { message: `Unhandled mock endpoint: ${method} ${pathname}` } },
      501,
    );
  };

  await Promise.all(API_ORIGINS.map((origin) => page.route(`${origin}/api/v1/**`, handleApiRoute)));

  return {
    workspaceId: db.workspaceId,
    seedProjectId: db.projects[0].id,
  };
}
