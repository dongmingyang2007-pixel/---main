import type { Page, Route } from "@playwright/test";

const APP_ORIGIN = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const API_ORIGIN = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

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

type MockDb = {
  workspaceId: string;
  projects: Project[];
  datasets: Dataset[];
  datasetVersions: DatasetVersion[];
  jobs: Job[];
  models: Model[];
  modelAliasesById: Record<string, ModelAlias[]>;
  modelVersionsById: Record<string, ModelVersion[]>;
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
    counters: {
      proj: 1,
      dataset: 1,
      dsv: 1,
      job: 1,
      model: 1,
      "model-version": 1,
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
  await page.context().addCookies([
    {
      name: "access_token",
      value: "playwright-access-token",
      url: APP_ORIGIN,
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "qihang_workspace_id",
      value: workspaceId,
      url: APP_ORIGIN,
      sameSite: "Lax",
    },
  ]);
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

  await page.route(`${API_ORIGIN}/api/v1/**`, async (route) => {
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
      await fulfillJson(route, { workspace: { id: db.workspaceId } });
      return;
    }

    if (pathname === "/api/v1/auth/login" && method === "POST") {
      await setAuthenticatedCookies(page, db.workspaceId);
      await fulfillJson(route, { workspace: { id: db.workspaceId } });
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
  });

  return {
    workspaceId: db.workspaceId,
    seedProjectId: db.projects[0].id,
  };
}
