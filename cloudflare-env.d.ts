declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    IMAGES: ImagesBinding;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
  }
}
