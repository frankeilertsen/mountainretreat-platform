-- E-mail to members: news/offers or important information, with images and attachments
CREATE TABLE mailings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL DEFAULT 'news' CHECK (kind IN ('news','info')),
  subject         TEXT NOT NULL DEFAULT '',
  body            TEXT NOT NULL DEFAULT '',
  subject_en      TEXT,
  body_en         TEXT,
  audience        JSONB NOT NULL DEFAULT '{"mode":"all","userIds":[],"leaderIds":[]}',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent')),
  recipient_count INTEGER,
  sent_at         TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE mailing_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailing_id   UUID NOT NULL REFERENCES mailings(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('image','attachment')),
  storage_key  TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  public_token TEXT NOT NULL UNIQUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mailing_files ON mailing_files (mailing_id, kind, sort_order);
