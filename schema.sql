CREATE TABLE IF NOT EXISTS account_snapshots (
  account_id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_snapshots_updated_at
ON account_snapshots(updated_at);
