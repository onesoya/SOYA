import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SOYA",
    short_name: "SOYA",
    description: "체성분, 식사, 운동과 나만의 리듬을 한 흐름으로 기록하는 건강 앱",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f3ea",
    theme_color: "#e9795f",
    icons: [
      {
        src: "/tiger-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/tiger-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
