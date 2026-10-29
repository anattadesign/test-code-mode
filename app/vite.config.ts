import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

// `shopify app dev` passes the app's settings as process env vars, but the server runs in
// workerd, which only sees Worker bindings. Forward them during `vite dev` only, so the
// API secret never lands in build output (production uses `wrangler secret put`).
const cliVars: Record<string, string> = {
  ...Object.fromEntries(
    ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "SCOPES"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k] as string]),
  ),
  // The dev app shares this store with production: never let it register its own tip
  // functions here (its tip guard would block real checkouts). See app.tipping.tsx.
  TIPPING_SETUP_BLOCKED_SHOPS: "anatta-store.myshopify.com",
};

export default defineConfig(({ command }) => ({
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules", "extensions/coupon-picker/assets"],
    },
  },
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      ...(command === "serve"
        ? { config: { vars: cliVars } }
        : {}),
    }),
    reactRouter(),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
}) satisfies UserConfig);
