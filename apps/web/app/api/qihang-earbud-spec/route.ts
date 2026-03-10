import { NextResponse } from "next/server";

import { buildQihangEarbudRuntimeSpecPayload } from "@/lib/qihang-earbud-spec";

export const revalidate = 300;

export function GET() {
  const payload = buildQihangEarbudRuntimeSpecPayload();
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    },
  });
}
