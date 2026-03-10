export function fnv1aHashHex(input = "") {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createSlidingRangeTracker(maxSamples = 40) {
  const values = [];
  const capacity = Math.max(2, Math.floor(maxSamples));
  return {
    push(value) {
      if (!Number.isFinite(value)) return;
      values.push(value);
      if (values.length > capacity) values.shift();
    },
    range() {
      if (values.length < 2) return 0;
      let min = values[0];
      let max = values[0];
      for (let i = 1; i < values.length; i += 1) {
        const value = values[i];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      return max - min;
    },
    reset() {
      values.length = 0;
    },
  };
}

export function overlapsAabbWithSafety(boxA, boxB, safety = 0) {
  if (!boxA || !boxB || !boxA.min || !boxA.max || !boxB.min || !boxB.max) return false;
  const ax = (boxA.min.x + boxA.max.x) * 0.5;
  const ay = (boxA.min.y + boxA.max.y) * 0.5;
  const az = (boxA.min.z + boxA.max.z) * 0.5;
  const bx = (boxB.min.x + boxB.max.x) * 0.5;
  const by = (boxB.min.y + boxB.max.y) * 0.5;
  const bz = (boxB.min.z + boxB.max.z) * 0.5;
  const ahx = Math.max((boxA.max.x - boxA.min.x) * 0.5, 0);
  const ahy = Math.max((boxA.max.y - boxA.min.y) * 0.5, 0);
  const ahz = Math.max((boxA.max.z - boxA.min.z) * 0.5, 0);
  const bhx = Math.max((boxB.max.x - boxB.min.x) * 0.5, 0);
  const bhy = Math.max((boxB.max.y - boxB.min.y) * 0.5, 0);
  const bhz = Math.max((boxB.max.z - boxB.min.z) * 0.5, 0);
  const gapX = Math.abs(ax - bx) - (ahx + bhx);
  const gapY = Math.abs(ay - by) - (ahy + bhy);
  const gapZ = Math.abs(az - bz) - (ahz + bhz);
  return gapX <= safety && gapY <= safety && gapZ <= safety;
}
