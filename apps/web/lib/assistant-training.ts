"use client";

import { apiGet, apiPost } from "@/lib/api";

type DatasetInfo = {
  id: string;
  name: string;
  type: string;
};

type DatasetVersion = {
  id: string;
  version: number;
};

async function ensureDataset(projectId: string): Promise<DatasetInfo> {
  const datasets = await apiGet<DatasetInfo[]>(`/api/v1/datasets?project_id=${projectId}`);
  if (datasets.length > 0) {
    return datasets[0];
  }

  return apiPost<DatasetInfo>("/api/v1/datasets", {
    project_id: projectId,
    name: "Default Knowledge",
    type: "text",
  });
}

async function ensureDatasetVersion(datasetId: string): Promise<DatasetVersion> {
  const versions = await apiGet<DatasetVersion[]>(`/api/v1/datasets/${datasetId}/versions`).catch(() => []);
  if (versions.length > 0) {
    return versions[0];
  }

  const result = await apiPost<{ dataset_version: DatasetVersion }>(
    `/api/v1/datasets/${datasetId}/commit`,
    {
      commit_message: "Initial snapshot",
      freeze_filter: { tag: null },
    },
  );
  return result.dataset_version;
}

export async function ensureTrainableDatasetVersion(projectId: string): Promise<string> {
  const dataset = await ensureDataset(projectId);
  const version = await ensureDatasetVersion(dataset.id);
  return version.id;
}

export async function startAssistantTraining(projectId: string): Promise<void> {
  const datasetVersionId = await ensureTrainableDatasetVersion(projectId);
  await apiPost("/api/v1/train/jobs", {
    project_id: projectId,
    dataset_version_id: datasetVersionId,
    recipe: "default",
    params_json: {},
  });
}
