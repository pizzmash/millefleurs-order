/* Existing bars are configured; bootstrap explicitly marks new bars incomplete. */
ALTER TABLE bars ADD COLUMN name_configured INTEGER NOT NULL DEFAULT 1 CHECK(name_configured IN (0,1));
