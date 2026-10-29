/// <reference types="vite/client" />

// Secrets aren't in wrangler.jsonc, so `wrangler types` doesn't know them.
declare namespace Cloudflare {
  interface Env {
    SHOPIFY_API_SECRET: string;
  }
}
