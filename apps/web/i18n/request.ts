import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

const NAMESPACES = [
  "common",
  "home",
  "product",
  "ecosystem",
  "demo",
  "pricing",
  "support",
  "updates",
  "auth",
  "error",
  "console",
  "console-projects",
  "console-datasets",
  "console-train",
  "console-models",
  "console-eval",
  "console-settings",
  "console-devices",
  "console-billing",
] as const;

type MessageValue = string | number | boolean | null | MessageValue[] | MessageObject;
type MessageObject = Record<string, MessageValue>;

function isMessageObject(value: unknown): value is MessageObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeMessages(target: MessageObject, source: MessageObject): MessageObject {
  const merged: MessageObject = { ...target };

  for (const [key, value] of Object.entries(source)) {
    const existing = merged[key];
    if (isMessageObject(existing) && isMessageObject(value)) {
      merged[key] = mergeMessages(existing, value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function expandDotKeys(messages: MessageObject): MessageObject {
  const expanded: MessageObject = {};

  for (const [rawKey, rawValue] of Object.entries(messages)) {
    const value = isMessageObject(rawValue) ? expandDotKeys(rawValue) : rawValue;
    const path = rawKey.split(".");

    let cursor = expanded;
    for (const segment of path.slice(0, -1)) {
      const current = cursor[segment];
      if (!isMessageObject(current)) {
        cursor[segment] = {};
      }
      cursor = cursor[segment] as MessageObject;
    }

    const leafKey = path[path.length - 1];
    const existing = cursor[leafKey];
    if (isMessageObject(existing) && isMessageObject(value)) {
      cursor[leafKey] = mergeMessages(existing, value);
    } else {
      cursor[leafKey] = value;
    }
  }

  return expanded;
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }

  const entries = await Promise.all(
    NAMESPACES.map(async (ns) => {
      const mod = await import(`../messages/${locale}/${ns}.json`);
      return [ns, expandDotKeys(mod.default as MessageObject)] as const;
    }),
  );

  return { locale, messages: Object.fromEntries(entries) };
});
