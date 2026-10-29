import { sessionStorage } from "../shopify.server";

/** Delete every stored session (offline and online) for a shop. */
export async function deleteShopSessions(shop: string) {
  const sessions = await sessionStorage.findSessionsByShop(shop);
  await sessionStorage.deleteSessions(sessions.map((s) => s.id));
}
