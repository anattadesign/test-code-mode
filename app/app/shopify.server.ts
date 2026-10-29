import "@shopify/shopify-api/adapters/web-api";
import { env } from "cloudflare:workers";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { D1SessionStorage } from "./lib/d1-session-storage.server";

// Runs on Cloudflare Workers. Settings come from wrangler.jsonc `vars`
// (SHOPIFY_API_KEY, SHOPIFY_APP_URL, SCOPES) and the SHOPIFY_API_SECRET secret.
const shopify = shopifyApp({
  apiKey: env.SHOPIFY_API_KEY,
  apiSecretKey: env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October26,
  scopes: env.SCOPES?.split(","),
  appUrl: env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new D1SessionStorage(() => env.DB),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
});

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
