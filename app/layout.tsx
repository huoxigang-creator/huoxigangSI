import type { Metadata } from "next";
import "./globals.css";
import "./catalog.css";
import ClientPolyfill from "./client-polyfill";

export const metadata: Metadata = {
  title: "SI · SI超级智能平台",
  description: "项目、报价、收付款与利润管理",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased"><ClientPolyfill />{children}</body>
    </html>
  );
}
