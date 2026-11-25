-- Reviews (omtaler) from Retreat Club stays, plus Airbnb reviews added by the administrator.
-- The administrator chooses which ones are shown on the front page.
CREATE TABLE reviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source                text NOT NULL CHECK (source IN ('retreat_club', 'airbnb')),
  booking_id            uuid UNIQUE REFERENCES bookings(id),
  member_id             uuid REFERENCES users(id),
  property_id           uuid REFERENCES properties(id),
  author_name           text NOT NULL,                 -- shown publicly, e.g. "Kari" or "Kari, Ålesund"
  stay_month            date,                          -- first day of the month of the stay
  rating                smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  rating_cleanliness    smallint CHECK (rating_cleanliness BETWEEN 1 AND 5),
  rating_accuracy       smallint CHECK (rating_accuracy BETWEEN 1 AND 5),
  rating_checkin        smallint CHECK (rating_checkin BETWEEN 1 AND 5),
  rating_communication  smallint CHECK (rating_communication BETWEEN 1 AND 5),
  rating_location       smallint CHECK (rating_location BETWEEN 1 AND 5),
  rating_value          smallint CHECK (rating_value BETWEEN 1 AND 5),
  public_text           text,
  private_feedback      text,                          -- only for us
  consent_publish       boolean NOT NULL DEFAULT false, -- the guest allows the text to be shown on the website
  lang                  text NOT NULL DEFAULT 'no',
  status                text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  featured              boolean NOT NULL DEFAULT false, -- shown on the front page
  featured_order        integer NOT NULL DEFAULT 100,
  host_reply            text,
  created_by_user_id    uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'retreat_club' AND booking_id IS NOT NULL AND member_id IS NOT NULL) OR source = 'airbnb'),
  CHECK (NOT featured OR (status = 'published' AND public_text IS NOT NULL AND public_text <> '' AND (source = 'airbnb' OR consent_publish)))
);
CREATE INDEX reviews_member_idx ON reviews (member_id);
CREATE INDEX reviews_featured_idx ON reviews (featured, featured_order) WHERE featured;

-- When the review request was sent for a stay (and the reminder)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_requested_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_reminded_at timestamptz;
