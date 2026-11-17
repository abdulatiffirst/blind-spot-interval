ALTER TABLE topics ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX topics_creation_key ON topics(user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
