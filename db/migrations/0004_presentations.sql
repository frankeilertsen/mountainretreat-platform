-- PDF presentations (pictures + information + member benefits) that can be attached to invitations
CREATE TABLE presentations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  original_filename    TEXT NOT NULL,
  storage_key          TEXT NOT NULL UNIQUE,
  size_bytes           INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256               TEXT NOT NULL,
  property_id          UUID REFERENCES properties(id),
  is_default           BOOLEAN NOT NULL DEFAULT false,
  active               BOOLEAN NOT NULL DEFAULT true,
  uploaded_by_user_id  UUID NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one default presentation (pre-selected on the invitation form)
CREATE UNIQUE INDEX uq_presentations_default ON presentations (is_default) WHERE is_default AND active;

ALTER TABLE invitations ADD COLUMN presentation_id UUID REFERENCES presentations(id);
ALTER TABLE invitations ADD COLUMN lang TEXT NOT NULL DEFAULT 'no' CHECK (lang IN ('no','en'));
