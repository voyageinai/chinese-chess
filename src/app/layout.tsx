import type { Metadata } from "next";
import {
  JetBrains_Mono,
  Ma_Shan_Zheng,
  Noto_Serif_SC,
} from "next/font/google";
import { Navbar } from "@/components/Navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "象棋擂台",
  description: "中国象棋引擎锦标赛平台",
};

const serifFont = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-serif-sc",
  display: "swap",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const brushFont = Ma_Shan_Zheng({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-ma-shan-zheng",
  display: "swap",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body
        className={`${serifFont.variable} ${monoFont.variable} ${brushFont.variable} min-h-screen bg-paper-100 text-ink font-serif antialiased`}
      >
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
