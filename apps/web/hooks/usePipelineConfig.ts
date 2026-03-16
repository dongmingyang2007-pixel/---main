"use client";

import { useState, useEffect, useCallback } from "react";

import { apiGet, apiPatch } from "@/lib/api";

export interface PipelineConfigItem {
  id: string;
  project_id: string;
  model_type: "llm" | "asr" | "tts" | "vision";
  model_id: string;
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface PipelineResponse {
  items: PipelineConfigItem[];
}

export function usePipelineConfig(projectId: string) {
  const [configs, setConfigs] = useState<PipelineConfigItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConfigs = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await apiGet<PipelineResponse>(
        `/api/v1/pipeline?project_id=${projectId}`,
      );
      setConfigs(Array.isArray(data.items) ? data.items : []);
    } catch {
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchConfigs();
  }, [fetchConfigs]);

  const updateConfig = async (
    modelType: string,
    modelId: string,
    configJson?: Record<string, unknown>,
  ) => {
    await apiPatch("/api/v1/pipeline", {
      project_id: projectId,
      model_type: modelType,
      model_id: modelId,
      config_json: configJson || {},
    });
    await fetchConfigs();
  };

  const getConfig = (modelType: string) =>
    configs.find((c) => c.model_type === modelType);

  return { configs, loading, updateConfig, getConfig, refetch: fetchConfigs };
}
