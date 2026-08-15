import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tricksight",
  description: "AIでスケートボードの練習動画を分析し、上達を記録する。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="dark h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
