"use client";

import { useState, useCallback } from "react";
import { UnifiedHeader } from "@/components/UnifiedHeader";
import { UnifiedMobileNav } from "@/components/UnifiedMobileNav";
import { SiteFooter } from "@/components/public/SiteFooter";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <>
      <UnifiedHeader onMobileMenuOpen={() => setMobileOpen(true)} />
      <main className="pt-16">{children}</main>
      <SiteFooter />
      <UnifiedMobileNav open={mobileOpen} onClose={closeMobile} mode="public" />
    </>
  );
}
