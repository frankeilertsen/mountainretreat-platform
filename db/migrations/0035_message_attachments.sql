-- Files attached to messages between members and the administration (images, PDF, documents)
CREATE TABLE message_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES messages(id),
  storage_key TEXT NOT NULL,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_message_attachments ON message_attachments (message_id);
