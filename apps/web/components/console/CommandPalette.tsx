"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const NAVIGATION_ITEMS = [
  { key: "nav.dashboard", href: "/app" },
  { key: "nav.projects", href: "/app/projects" },
  { key: "nav.datasets", href: "/app/datasets" },
  { key: "nav.train", href: "/app/train" },
  { key: "nav.models", href: "/app/models" },
  { key: "nav.eval", href: "/app/eval" },
  { key: "nav.settings", href: "/app/settings" },
];

const ACTION_ITEMS = [
  { key: "cmd.newProject", href: "/app/projects" },
  { key: "cmd.newDataset", href: "/app/datasets" },
  { key: "cmd.startTraining", href: "/app/train" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const t = useTranslations("console");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t("cmd.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("cmd.empty")}</CommandEmpty>
        <CommandGroup heading={t("cmd.navigate")}>
          {NAVIGATION_ITEMS.map((item) => (
            <CommandItem
              key={item.href}
              onSelect={() => navigate(item.href)}
            >
              {t(item.key)}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={t("cmd.actions")}>
          {ACTION_ITEMS.map((item) => (
            <CommandItem
              key={`action-${item.href}`}
              onSelect={() => navigate(item.href)}
            >
              {t(item.key)}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
