import { UnifiedHeader } from "@/components/UnifiedHeader";
import { UnifiedMobileNav } from "@/components/UnifiedMobileNav";
import { MobileMenuProvider } from "@/components/MobileMenuProvider";
import { SiteFooter } from "@/components/public/SiteFooter";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <MobileMenuProvider>
      <UnifiedHeader />
      <main className="pt-16">{children}</main>
      <SiteFooter />
      <UnifiedMobileNav mode="public" />
    </MobileMenuProvider>
  );
}
