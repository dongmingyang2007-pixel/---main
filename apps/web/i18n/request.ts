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
  "console-settings",
  "console-devices",
  "console-assistants",
  "console-knowledge",
  "console-training",
  "console-chat",
] as const;

const MESSAGE_LOADERS = {
  zh: {
    common: () => import("../messages/zh/common.json"),
    home: () => import("../messages/zh/home.json"),
    product: () => import("../messages/zh/product.json"),
    ecosystem: () => import("../messages/zh/ecosystem.json"),
    demo: () => import("../messages/zh/demo.json"),
    pricing: () => import("../messages/zh/pricing.json"),
    support: () => import("../messages/zh/support.json"),
    updates: () => import("../messages/zh/updates.json"),
    auth: () => import("../messages/zh/auth.json"),
    error: () => import("../messages/zh/error.json"),
    console: () => import("../messages/zh/console.json"),
    "console-settings": () => import("../messages/zh/console-settings.json"),
    "console-devices": () => import("../messages/zh/console-devices.json"),
    "console-assistants": () => import("../messages/zh/console-assistants.json"),
    "console-knowledge": () => import("../messages/zh/console-knowledge.json"),
    "console-training": () => import("../messages/zh/console-training.json"),
    "console-chat": () => import("../messages/zh/console-chat.json"),
  },
  en: {
    common: () => import("../messages/en/common.json"),
    home: () => import("../messages/en/home.json"),
    product: () => import("../messages/en/product.json"),
    ecosystem: () => import("../messages/en/ecosystem.json"),
    demo: () => import("../messages/en/demo.json"),
    pricing: () => import("../messages/en/pricing.json"),
    support: () => import("../messages/en/support.json"),
    updates: () => import("../messages/en/updates.json"),
    auth: () => import("../messages/en/auth.json"),
    error: () => import("../messages/en/error.json"),
    console: () => import("../messages/en/console.json"),
    "console-settings": () => import("../messages/en/console-settings.json"),
    "console-devices": () => import("../messages/en/console-devices.json"),
    "console-assistants": () => import("../messages/en/console-assistants.json"),
    "console-knowledge": () => import("../messages/en/console-knowledge.json"),
    "console-training": () => import("../messages/en/console-training.json"),
    "console-chat": () => import("../messages/en/console-chat.json"),
  },
} as const;

type MessageObject = Record<string, unknown>;

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
  const requestLocaleValue = await requestLocale;
  const localeKey = requestLocaleValue as (typeof routing.locales)[number] | undefined;
  const locale = localeKey && routing.locales.includes(localeKey)
    ? localeKey
    : routing.defaultLocale;

  const entries = await Promise.all(
    NAMESPACES.map(async (ns) => {
      const mod = await MESSAGE_LOADERS[locale][ns]();
      return [ns, expandDotKeys(mod.default as MessageObject)] as const;
    }),
  );

  return { locale, messages: Object.fromEntries(entries) };
});
