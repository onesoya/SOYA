import type { Metadata, Viewport } from "next";
import "galmuri/dist/galmuri.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: "SOYA",
  applicationName: "SOYA",
  openGraph: {
    title: "SOYA",
    siteName: "SOYA",
    type: "website",
    images: [{ url: "/tiger-icon-512.png", width: 512, height: 512, alt: "SOYA 호랑이" }],
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
