import { headers } from "next/headers";

import { HomeScrollStory } from "@/components/HomeScrollStory";
import { resolveRequestOrigin } from "@/lib/request-origin";

export default async function HomePage() {
  const headerStore = await headers();
  const origin = resolveRequestOrigin(headerStore);

  return <HomeScrollStory viewerParentOrigin={origin} />;
}
