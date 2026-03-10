export type EarbudPrintProfile = "general" | "fdm" | "sla";

export type EarbudBuildTier = "display" | "prototype" | "engineering";

export const EARBUD_BUILD_TIER: EarbudBuildTier = "engineering";
export const QIHANG_EARBUD_SPEC_ENDPOINT = "/api/qihang-earbud-spec";

export const QIHANG_EARBUD_SPEC = {
  revision: "tws-anc-prototype-v1",
  fitTarget: "universal_medium_ear_canal",
  envelopeMm: {
    x: 15.2,
    y: 20.6,
    z: 17.8,
  },
  nozzle: {
    outerDiameterMm: 4.8,
    innerDiameterMm: 2.6,
    tiltDeg: 37,
  },
  acoustic: {
    driverDiameterMm: 10,
    rearPressureReliefHoleMm: 0.8,
    feedforwardMicPortMm: 1.1,
    feedbackMicPortMm: 0.9,
  },
  moduleEnvelopesMm: {
    driver: { x: 10.8, y: 10.8, z: 4.2 },
    battery: { x: 11.6, y: 9.8, z: 5.1 },
    pcb: { x: 14.0, y: 9.0, z: 1.6 },
  },
  charging: {
    contactPadDiameterMm: 1.4,
    contactPadPitchMm: 4.0,
    compressionRangeMm: { min: 0.4, max: 0.7 },
  },
  fit: {
    radialClearanceRangeMm: { min: 0.5, max: 1.0 },
    dockOffsetToleranceMm: 0.3,
  },
  ancLayout: "feedforward_feedback_dual_mic",
} as const;

export const EARBUD_PRINT_PROFILE_SPEC: Record<
  EarbudPrintProfile,
  {
    shellMinWallMm: number;
    supportRibMinMm: number;
    guidance: string;
  }
> = {
  general: {
    shellMinWallMm: 1.2,
    supportRibMinMm: 1.6,
    guidance: "General engineering prototype profile",
  },
  fdm: {
    shellMinWallMm: 1.4,
    supportRibMinMm: 1.8,
    guidance: "FDM-compatible wall/rib safety margins",
  },
  sla: {
    shellMinWallMm: 1.2,
    supportRibMinMm: 1.6,
    guidance: "SLA-optimized shell precision profile",
  },
};

export function resolveEarbudPrintProfile(profile: string | undefined): EarbudPrintProfile {
  if (profile === "fdm" || profile === "sla") return profile;
  return "general";
}

type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike };

function stableStringify(value: JsonLike): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, JsonLike>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
}

function fnv1aHashHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export type QihangEarbudRuntimeSpecPayload = {
  revision: string;
  buildTier: EarbudBuildTier;
  fitTarget: string;
  envelopeMm: {
    x: number;
    y: number;
    z: number;
  };
  nozzle: {
    outerDiameterMm: number;
    innerDiameterMm: number;
    tiltDeg: number;
  };
  acoustic: {
    driverDiameterMm: number;
    rearPressureReliefHoleMm: number;
    feedforwardMicPortMm: number;
    feedbackMicPortMm: number;
  };
  moduleEnvelopesMm: {
    driver: { x: number; y: number; z: number };
    battery: { x: number; y: number; z: number };
    pcb: { x: number; y: number; z: number };
  };
  charging: {
    contactPadDiameterMm: number;
    contactPadPitchMm: number;
    compressionRangeMm: { min: number; max: number };
  };
  fit: {
    radialClearanceRangeMm: { min: number; max: number };
    dockOffsetToleranceMm: number;
  };
  ancLayout: string;
  printProfiles: Record<
    EarbudPrintProfile,
    {
      shellMinWallMm: number;
      supportRibMinMm: number;
      guidance: string;
    }
  >;
  spec_source_hash: string;
  generated_from: "qihang-earbud-spec.ts";
};

export function buildQihangEarbudRuntimeSpecPayload(): QihangEarbudRuntimeSpecPayload {
  const runtimeSpec = {
    revision: QIHANG_EARBUD_SPEC.revision,
    buildTier: EARBUD_BUILD_TIER,
    fitTarget: QIHANG_EARBUD_SPEC.fitTarget,
    envelopeMm: { ...QIHANG_EARBUD_SPEC.envelopeMm },
    nozzle: { ...QIHANG_EARBUD_SPEC.nozzle },
    acoustic: { ...QIHANG_EARBUD_SPEC.acoustic },
    moduleEnvelopesMm: {
      driver: { ...QIHANG_EARBUD_SPEC.moduleEnvelopesMm.driver },
      battery: { ...QIHANG_EARBUD_SPEC.moduleEnvelopesMm.battery },
      pcb: { ...QIHANG_EARBUD_SPEC.moduleEnvelopesMm.pcb },
    },
    charging: {
      contactPadDiameterMm: QIHANG_EARBUD_SPEC.charging.contactPadDiameterMm,
      contactPadPitchMm: QIHANG_EARBUD_SPEC.charging.contactPadPitchMm,
      compressionRangeMm: { ...QIHANG_EARBUD_SPEC.charging.compressionRangeMm },
    },
    fit: {
      radialClearanceRangeMm: { ...QIHANG_EARBUD_SPEC.fit.radialClearanceRangeMm },
      dockOffsetToleranceMm: QIHANG_EARBUD_SPEC.fit.dockOffsetToleranceMm,
    },
    ancLayout: QIHANG_EARBUD_SPEC.ancLayout,
    printProfiles: {
      general: { ...EARBUD_PRINT_PROFILE_SPEC.general },
      fdm: { ...EARBUD_PRINT_PROFILE_SPEC.fdm },
      sla: { ...EARBUD_PRINT_PROFILE_SPEC.sla },
    },
  } satisfies Omit<QihangEarbudRuntimeSpecPayload, "spec_source_hash" | "generated_from">;

  const specSourceHash = fnv1aHashHex(stableStringify(runtimeSpec as JsonLike));
  return {
    ...runtimeSpec,
    spec_source_hash: specSourceHash,
    generated_from: "qihang-earbud-spec.ts",
  };
}
