"use client";

import { apiGet, apiPost } from "@/lib/api";
import { ensureKnowledgeDataset } from "@/lib/knowledge-upload";

type DatasetVersion = {
  id: string;
  version: number;
};

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
  const dataset = await ensureKnowledgeDataset(projectId);
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
