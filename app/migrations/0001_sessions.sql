-- Shopify sessions (offline and online access tokens) for the Coupons & Tipping app.
CREATE TABLE IF NOT EXISTS sessions (
  id   TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_shop ON sessions (shop);
