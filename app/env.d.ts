/// <reference types="vite/client" />

// Secrets aren't in wrangler.jsonc, so `wrangler types` doesn't know them.
declare namespace Cloudflare {
  interface Env {
    SHOPIFY_API_SECRET: string;
    /** Comma-separated shops where Tipping → Set up is refused (dev only, see vite.config.ts). */
    TIPPING_SETUP_BLOCKED_SHOPS?: string;
  }
}
