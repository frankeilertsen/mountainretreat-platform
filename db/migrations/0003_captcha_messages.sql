-- Spam protection: each verification code (captcha) can be used once
CREATE TABLE captcha_used (
  nonce    TEXT PRIMARY KEY,
  used_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_captcha_used_at ON captcha_used (used_at);

-- Language the user last chose (used for e-mails to that user)
ALTER TABLE users ADD COLUMN preferred_lang TEXT NOT NULL DEFAULT 'no' CHECK (preferred_lang IN ('no','en'));

-- Messages between members and the administration
CREATE TABLE conversations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id             UUID NOT NULL REFERENCES users(id),
  subject               TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 160),
  booking_id            UUID REFERENCES bookings(id),
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  started_by            TEXT NOT NULL CHECK (started_by IN ('member','admin')),
  created_by_user_id    UUID NOT NULL REFERENCES users(id),
  last_message_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_by       TEXT NOT NULL CHECK (last_message_by IN ('member','admin')),
  member_last_read_at   TIMESTAMPTZ,
  admin_last_read_at    TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_member ON conversations (member_id, last_message_at DESC);
CREATE INDEX idx_conversations_inbox ON conversations (status, last_message_at DESC);

CREATE TABLE messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id),
  sender_user_id   UUID NOT NULL REFERENCES users(id),
  sender_side      TEXT NOT NULL CHECK (sender_side IN ('member','admin')),
  body             TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at);

-- Message history is kept: messages cannot be changed or deleted (anonymisation clears the account, not the thread)
CREATE OR REPLACE FUNCTION messages_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'messages are append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_messages_append_only BEFORE UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION messages_append_only();

