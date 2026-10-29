import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

/** The subset of Cloudflare's D1Database that this storage uses. */
export interface D1Like {
  prepare(query: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown>;
}
interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

type Row = { data: string };

/**
 * Shopify session storage on Cloudflare D1 (SQLite).
 * Sessions are stored as Shopify's own property array (`toPropertyArray(true)`),
 * the same format the official KV adapter uses, so every field round-trips:
 * offline/online tokens, refresh tokens, expiry dates and online user data.
 * Table: migrations/0001_sessions.sql.
 */
export class D1SessionStorage implements SessionStorage {
  constructor(private readonly db: () => D1Like) {}

  async storeSession(session: Session): Promise<boolean> {
    await this.db()
      .prepare(
        "INSERT INTO sessions (id, shop, data) VALUES (?1, ?2, ?3) " +
          "ON CONFLICT(id) DO UPDATE SET shop = excluded.shop, data = excluded.data",
      )
      .bind(session.id, session.shop, JSON.stringify(session.toPropertyArray(true)))
      .run();
    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const row = await this.db().prepare("SELECT data FROM sessions WHERE id = ?1").bind(id).first<Row>();
    return row ? toSession(row) : undefined;
  }

  async deleteSession(id: string): Promise<boolean> {
    await this.db().prepare("DELETE FROM sessions WHERE id = ?1").bind(id).run();
    return true;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const db = this.db();
    await db.batch(ids.map((id) => db.prepare("DELETE FROM sessions WHERE id = ?1").bind(id)));
    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const { results } = await this.db()
      .prepare("SELECT data FROM sessions WHERE shop = ?1")
      .bind(shop)
      .all<Row>();
    return results.map(toSession);
  }
}

function toSession(row: Row): Session {
  return Session.fromPropertyArray(JSON.parse(row.data), true);
}
