import type { Metadata } from "next";
import { DM_Sans, Inter, JetBrains_Mono, Sora, Noto_Sans_SC } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { Providers } from "@/components/providers";
import { routing } from "@/i18n/routing";
import "@/styles/globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-sora",
  display: "swap",
});

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-sc",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const localeKey = locale as (typeof routing.locales)[number];

  if (!routing.locales.includes(localeKey)) {
    notFound();
  }

  setRequestLocale(localeKey);
  const t = await getTranslations("common");
  const th = await getTranslations("home");
  return {
    title: {
      template: `%s - ${t("brand.company")}`,
      default: th("meta.title"),
    },
    description: th("meta.description"),
    openGraph: {
      locale: localeKey === "zh" ? "zh_CN" : "en_US",
    },
    alternates: {
      languages: {
        zh: "/",
        en: "/en",
      },
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const localeKey = locale as (typeof routing.locales)[number];

  if (!routing.locales.includes(localeKey)) {
    notFound();
  }

  setRequestLocale(localeKey);
  const messages = await getMessages();

  return (
    <html lang={localeKey} suppressHydrationWarning>
      <body className={`${dmSans.variable} ${inter.variable} ${jetbrainsMono.variable} ${sora.variable} ${notoSansSC.variable}`}>
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
