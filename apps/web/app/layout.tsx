import type { Metadata } from "next";
import { DM_Sans, Sora } from "next/font/google";

import { Providers } from "@/components/providers";
import "@/styles/globals.css";

const plex = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
});

const display = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "QIHANG - 环境 AI 工作台",
  description: "离线优先的环境 AI 设备与数据工作流。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={`${plex.variable} ${display.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
