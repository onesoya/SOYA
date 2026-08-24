import type { Metadata, Viewport } from "next";
import "galmuri/dist/galmuri.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "나의 밸런스",
  description: "체성분, 식사, 운동을 한 흐름으로 관리하는 나만의 건강 기록 앱",
  openGraph: {
    title: "나의 밸런스",
    description: "체성분, 식사, 운동을 한 흐름으로 관리하는 나만의 건강 기록 앱",
    images: ["/og-preview.png"],
  },
  icons: {
    icon: [
      { url: "/tiger-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/tiger-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/tiger-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
