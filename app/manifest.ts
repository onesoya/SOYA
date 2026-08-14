import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "나의 밸런스",
    short_name: "밸런스",
    description: "체성분, 식사, 운동을 한 흐름으로 관리하는 개인 건강 기록 앱",
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
