export type ViewerRuntimeState = Record<string, unknown>;

export type ViewerVector3 = {
  x: number;
  y: number;
  z: number;
  clone: () => ViewerVector3;
  add: (other: ViewerVector3) => ViewerVector3;
  multiplyScalar: (value: number) => ViewerVector3;
};

export type ViewerBoundingBox = {
  min: ViewerVector3;
  max: ViewerVector3;
};

export type ViewerGeometry = {
  boundingBox: ViewerBoundingBox;
  computeBoundingBox: () => void;
};

export type ViewerObject3D = {
  name?: string;
  visible?: boolean;
  isMesh?: boolean;
  parent?: { remove: (node: ViewerObject3D) => void } | null;
  traverse: (callback: (node: ViewerObject3D) => void) => void;
  getObjectByName: (name: string) => ViewerObject3D | null;
  updateMatrixWorld: (force?: boolean) => void;
  matrixWorld: { elements: number[] };
  geometry: ViewerGeometry;
  localToWorld: (vector: ViewerVector3) => void;
  position: Partial<Record<"x" | "y" | "z", number>>;
  rotation: Partial<Record<"x" | "y" | "z", number>>;
};

export type ViewerDebugRuntime = {
  product: ViewerObject3D;
  baseGroup: ViewerObject3D;
  lidGroup: ViewerObject3D;
  baseShell: ViewerObject3D;
  lidShell: ViewerObject3D;
  lidPivot: { position: Partial<Record<"x" | "y" | "z", number>> };
};

export type ViewerApi = {
  getState?: () => ViewerRuntimeState | null;
  setState?: (patch: Record<string, unknown>) => void;
  command?: (name: string) => void;
};

export type ViewerWindow = Window & {
  QIHANG_MODEL?: ViewerApi;
  __QIHANG_DEBUG?: ViewerDebugRuntime;
  __QIHANG_RENDER_MODE?: string | null;
};
