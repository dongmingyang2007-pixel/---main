import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }

  const namespaces = [
    "common", "home", "product", "ecosystem", "demo", "pricing",
    "support", "updates", "auth", "error", "console",
    "console-projects", "console-datasets", "console-train",
    "console-models", "console-eval", "console-settings",
    "console-devices", "console-billing",
  ];
  const messages: Record<string, any> = {};
  for (const ns of namespaces) {
    messages[ns] = (await import(`../messages/${locale}/${ns}.json`)).default;
  }

  return { locale, messages };
});
