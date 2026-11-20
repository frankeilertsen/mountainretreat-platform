-- FKE Property AS / mountainretreat.no — Friends & Family platform
-- Full schema. Money is stored as integer øre (1/100 NOK). Statuses are TEXT + CHECK.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============ IDENTITY & AUTH ============
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT NOT NULL,
  phone                 TEXT,
  name                  TEXT NOT NULL,
  system_role           TEXT NOT NULL DEFAULT 'member'
                          CHECK (system_role IN ('super_admin','admin','member','helper')),
  status                TEXT NOT NULL DEFAULT 'invited'
                          CHECK (status IN ('invited','active','suspended','revoked','anonymized')),
  invite_tier           TEXT CHECK (invite_tier IN ('admin_invited','member_invited')),
  loyalty_status        TEXT NOT NULL DEFAULT 'not_applicable'
                          CHECK (loyalty_status IN ('not_applicable','can_apply','applied','approved')),
  invited_by_user_id    UUID REFERENCES users(id),
  referral_code         TEXT UNIQUE,                    -- personal shareable code (members)
  cleaning_scope        TEXT NOT NULL DEFAULT 'assigned' CHECK (cleaning_scope IN ('assigned','all')),
  cleaning_feed_token_hash TEXT UNIQUE,
  totp_secret_encrypted TEXT,
  totp_enrolled_at      TIMESTAMPTZ,
  recovery_codes_hashed TEXT[],
  failed_totp_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  marketing_consent     BOOLEAN NOT NULL DEFAULT false,
  member_discount_override_pct NUMERIC(5,2) CHECK (member_discount_override_pct BETWEEN 0 AND 100), -- NULL = platform standard
  notify_email          BOOLEAN NOT NULL DEFAULT true,
  notify_sms            BOOLEAN NOT NULL DEFAULT true,
  last_login_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness prevents duplicate accounts (Ola@x.no vs ola@x.no)
CREATE UNIQUE INDEX uq_users_email_ci ON users (lower(email));

CREATE TABLE login_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id),
  session_token_hash   TEXT NOT NULL UNIQUE,
  aal                  SMALLINT NOT NULL DEFAULT 1,        -- 1 = magic link only, 2 = TOTP verified
  ip_address           INET,
  user_agent           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL,
  last_activity_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  idle_timeout_minutes INTEGER NOT NULL DEFAULT 60,
  step_up_at           TIMESTAMPTZ,
  revoked_at           TIMESTAMPTZ
);
CREATE INDEX idx_sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE rate_limits (
  key           TEXT PRIMARY KEY,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER NOT NULL
);

CREATE TABLE invitations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_user_id    UUID NOT NULL REFERENCES users(id),
  invitee_email      TEXT NOT NULL,
  invitee_name       TEXT,
  role               TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','helper')),
  property_id        UUID,                             -- helper invitations: property to assign on signup
  token_hash         TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','accepted','expired','revoked')),
  expires_at         TIMESTAMPTZ NOT NULL,
  accepted_at        TIMESTAMPTZ,
  accepted_user_id   UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invitations_email ON invitations (lower(invitee_email));
-- Only one live invitation per email address at a time
CREATE UNIQUE INDEX uq_invitation_pending_email ON invitations (lower(invitee_email)) WHERE status = 'pending';

CREATE TABLE loyalty_applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_user_id     UUID NOT NULL REFERENCES users(id),
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by_user_id   UUID REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_loyalty_pending ON loyalty_applications (applicant_user_id) WHERE status = 'pending';

CREATE TABLE referrals (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id       UUID NOT NULL REFERENCES users(id),
  referred_user_id       UUID NOT NULL UNIQUE REFERENCES users(id),
  invitation_id          UUID NOT NULL REFERENCES invitations(id),
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','qualified','void')),
  qualifying_booking_id  UUID,
  qualified_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (referrer_user_id <> referred_user_id)               -- no self-referrals
);

-- ============ PROPERTY & PRICING ============
CREATE TABLE properties (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  address           TEXT,
  short_description TEXT,
  description       TEXT,
  amenities         TEXT[] NOT NULL DEFAULT '{}',
  house_rules       TEXT,
  max_guests        INTEGER NOT NULL DEFAULT 2 CHECK (max_guests >= 1),
  check_in_time     TIME NOT NULL DEFAULT '15:00',
  check_out_time    TIME NOT NULL DEFAULT '11:00',
  cleaning_fee_ore  INTEGER NOT NULL DEFAULT 0 CHECK (cleaning_fee_ore >= 0),
  -- 'airbnb' (default): nightly prices follow the listing's Airbnb prices (external_nightly_rates)
  -- 'manual': nightly prices come from the season pricing below
  pricing_mode      TEXT NOT NULL DEFAULT 'airbnb' CHECK (pricing_mode IN ('airbnb','manual')),
  default_min_nights INTEGER NOT NULL DEFAULT 2 CHECK (default_min_nights >= 1),
  base_currency     TEXT NOT NULL DEFAULT 'NOK',
  timezone          TEXT NOT NULL DEFAULT 'Europe/Oslo',
  owner_user_id     UUID REFERENCES users(id),
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE season_categories (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id                 UUID NOT NULL REFERENCES properties(id),
  kind                        TEXT NOT NULL CHECK (kind IN ('low_season','high_season','holiday')),
  name                        TEXT NOT NULL,
  color                       TEXT,
  price_per_night_ore         INTEGER NOT NULL CHECK (price_per_night_ore >= 0),
  min_nights                  INTEGER NOT NULL DEFAULT 1 CHECK (min_nights >= 1),
  max_nights                  INTEGER CHECK (max_nights IS NULL OR max_nights >= min_nights),
  active                      BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, kind),
  UNIQUE (id, property_id)
);

CREATE TABLE pricing_periods (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id                 UUID NOT NULL REFERENCES properties(id),
  season_category_id          UUID NOT NULL,
  name                        TEXT NOT NULL,
  start_date                  DATE NOT NULL,
  end_date                    DATE NOT NULL,                 -- inclusive (last night)
  price_per_night_ore         INTEGER CHECK (price_per_night_ore >= 0),
  min_nights                  INTEGER CHECK (min_nights IS NULL OR min_nights >= 1),
  max_nights                  INTEGER CHECK (max_nights IS NULL OR max_nights >= 1),
  booking_mode                TEXT NOT NULL DEFAULT 'flexible'
                                CHECK (booking_mode IN ('flexible','whole_period','fixed_changeover_day')),
  changeover_weekday          SMALLINT CHECK (changeover_weekday BETWEEN 1 AND 7),
  priority                    INTEGER NOT NULL DEFAULT 0,
  active                      BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK ((booking_mode = 'fixed_changeover_day') = (changeover_weekday IS NOT NULL)),
  FOREIGN KEY (season_category_id, property_id) REFERENCES season_categories (id, property_id)
);
CREATE INDEX idx_pricing_periods_property_dates ON pricing_periods (property_id, start_date, end_date);

-- Airbnb nightly prices per date (entered from the Airbnb calendar, pasted/CSV, or later synced from a channel manager)
CREATE TABLE external_nightly_rates (
  property_id        UUID NOT NULL REFERENCES properties(id),
  date               DATE NOT NULL,
  price_ore          INTEGER NOT NULL CHECK (price_ore > 0),
  source             TEXT NOT NULL DEFAULT 'manual_entry' CHECK (source IN ('manual_entry','paste','channel_manager')),
  updated_by_user_id UUID REFERENCES users(id),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, date)
);

CREATE TABLE length_of_stay_discounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           UUID NOT NULL REFERENCES properties(id),
  season_category_id    UUID,
  min_nights            INTEGER NOT NULL CHECK (min_nights >= 2),
  discount_percentage   NUMERIC(5,2) NOT NULL CHECK (discount_percentage > 0 AND discount_percentage <= 100),
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (season_category_id, property_id) REFERENCES season_categories (id, property_id)
);

CREATE TABLE add_on_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id),
  name            TEXT NOT NULL,
  description     TEXT,
  price_type      TEXT NOT NULL CHECK (price_type IN ('flat','per_night','per_unit','per_guest')),
  unit_price_ore  INTEGER NOT NULL CHECK (unit_price_ore >= 0),
  mandatory       BOOLEAN NOT NULL DEFAULT false,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE member_cleaning_exemptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id),
  property_id           UUID REFERENCES properties(id),
  active                BOOLEAN NOT NULL DEFAULT true,
  granted_by_user_id    UUID NOT NULL REFERENCES users(id),
  granted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes                 TEXT
);

-- ============ ROOMS & BEDS (cleaning / bed preparation) ============
CREATE TABLE rooms (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           UUID NOT NULL REFERENCES properties(id),
  name                  TEXT NOT NULL,
  floor                 TEXT,
  description           TEXT,
  max_capacity          INTEGER NOT NULL DEFAULT 2 CHECK (max_capacity >= 0),
  bedding_instructions  TEXT,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, property_id)
);

CREATE TABLE beds (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id          UUID NOT NULL REFERENCES properties(id),
  room_id              UUID NOT NULL,
  label                TEXT NOT NULL,
  bed_type             TEXT NOT NULL CHECK (bed_type IN
                         ('double','single','bunk_lower','bunk_upper','sofa_bed','extra_mattress','cot')),
  sleeps               INTEGER NOT NULL CHECK (sleeps BETWEEN 1 AND 4),
  width_cm             INTEGER,
  length_cm            INTEGER,
  allocation_priority  INTEGER NOT NULL DEFAULT 100,   -- lower = filled first; sofa beds typically last
  children_only        BOOLEAN NOT NULL DEFAULT false, -- e.g. upper bunk
  active               BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, property_id),
  FOREIGN KEY (room_id, property_id) REFERENCES rooms (id, property_id)
);

-- ============ CHANNELS & CALENDAR ============
-- One row per connection between a property and an external channel.
-- integration_mode makes the capability explicit: iCal import, iCal export, full API, or channel manager.
CREATE TABLE channel_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           UUID NOT NULL REFERENCES properties(id),
  channel               TEXT NOT NULL CHECK (channel IN
                          ('airbnb','booking_com','vrbo','expedia','guesty','hostaway','other')),
  display_name          TEXT NOT NULL,
  integration_mode      TEXT NOT NULL CHECK (integration_mode IN
                          ('ical_import','ical_export','api','channel_manager')),
  ical_url              TEXT,
  export_token_hash     TEXT UNIQUE,
  config                JSONB NOT NULL DEFAULT '{}',   -- non-secret settings (listing id etc.). Secrets live in env.
  last_synced_at        TIMESTAMPTZ,
  last_sync_status      TEXT CHECK (last_sync_status IN ('success','failure','never')),
  last_error            TEXT,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  last_fetched_at       TIMESTAMPTZ,                   -- export: last time the channel pulled our feed
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (integration_mode <> 'ical_import' OR ical_url IS NOT NULL),
  CHECK (integration_mode <> 'ical_export' OR export_token_hash IS NOT NULL)
);

CREATE TABLE external_calendar_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id),
  connection_id    UUID NOT NULL REFERENCES channel_connections(id),
  uid              TEXT NOT NULL,
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,                     -- exclusive (checkout day)
  raw_summary      TEXT,
  block_kind       TEXT NOT NULL DEFAULT 'unknown' CHECK (block_kind IN ('reservation','owner_block','unknown')),
  sync_state       TEXT NOT NULL DEFAULT 'active' CHECK (sync_state IN ('active','echo','conflict','removed')),
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at       TIMESTAMPTZ,
  UNIQUE (connection_id, uid)
);

CREATE TABLE channel_sync_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES channel_connections(id),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failure')),
  events_added    INTEGER NOT NULL DEFAULT 0,
  events_removed  INTEGER NOT NULL DEFAULT 0,
  conflicts       INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);

-- THE core double-booking defence: overlapping ranges for one property are physically impossible.
CREATE TABLE availability_blocks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id        UUID NOT NULL REFERENCES properties(id),
  date_range         DATERANGE NOT NULL,
  block_type         TEXT NOT NULL CHECK (block_type IN ('external_sync','manual_admin','platform_booking')),
  reference_id       UUID,
  source_connection_id UUID REFERENCES channel_connections(id),  -- for external_sync: which channel it came from
  reason             TEXT,
  created_by_user_id UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  EXCLUDE USING GIST (property_id WITH =, date_range WITH &&),
  CHECK (NOT isempty(date_range))
);

-- ============ BOOKING ============
CREATE TABLE cancellation_policy_tiers (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id               UUID REFERENCES properties(id),
  days_before_checkin_min   INTEGER NOT NULL,
  days_before_checkin_max   INTEGER,
  refund_percentage         NUMERIC(5,2) NOT NULL CHECK (refund_percentage BETWEEN 0 AND 100),
  requires_admin_approval   BOOLEAN NOT NULL DEFAULT false,
  active                    BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             TEXT NOT NULL UNIQUE,         -- human friendly e.g. MR-7K3D9Q
  property_id           UUID NOT NULL REFERENCES properties(id),
  member_id             UUID NOT NULL REFERENCES users(id),
  start_date            DATE NOT NULL,
  end_date              DATE NOT NULL,
  adults                INTEGER NOT NULL DEFAULT 1 CHECK (adults >= 1),
  children              INTEGER NOT NULL DEFAULT 0 CHECK (children >= 0),
  infants               INTEGER NOT NULL DEFAULT 0 CHECK (infants >= 0),
  status                TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN (
                          'pending_review','rejected','awaiting_payment','expired',
                          'confirmed','cancellation_requested','cancelled','completed')),
  payment_method        TEXT CHECK (payment_method IN ('stripe_card','vipps','invoice')),
  stay_price_ore        INTEGER NOT NULL,
  cleaning_fee_ore      INTEGER NOT NULL DEFAULT 0,
  add_ons_price_ore     INTEGER NOT NULL DEFAULT 0,
  reward_discount_ore   INTEGER NOT NULL DEFAULT 0,
  price_total_ore       INTEGER NOT NULL,             -- what the member pays (after reward discount)
  price_breakdown       JSONB NOT NULL DEFAULT '{}',
  price_locked_at       TIMESTAMPTZ,                  -- set on approval; never recomputed afterwards
  currency              TEXT NOT NULL DEFAULT 'NOK',
  special_requests      TEXT,
  admin_reviewer_id     UUID REFERENCES users(id),
  rejection_reason      TEXT,
  cancelled_reason      TEXT CHECK (cancelled_reason IN
                          ('member_request','admin_action','membership_revoked','payment_expired','timeout_auto_approval')),
  request_idempotency_key TEXT,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at           TIMESTAMPTZ,
  confirmed_at          TIMESTAMPTZ,
  cancellation_requested_at TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date > start_date),
  CHECK (price_total_ore >= 0),
  UNIQUE (member_id, request_idempotency_key)
);
CREATE INDEX idx_bookings_property_status ON bookings (property_id, status);
CREATE INDEX idx_bookings_member ON bookings (member_id);
ALTER TABLE referrals ADD CONSTRAINT fk_referrals_booking FOREIGN KEY (qualifying_booking_id) REFERENCES bookings(id);

CREATE TABLE booking_add_ons (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id                  UUID NOT NULL REFERENCES bookings(id),
  add_on_item_id              UUID NOT NULL REFERENCES add_on_items(id),
  quantity                    INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_price_at_selection_ore INTEGER NOT NULL,
  total_price_ore             INTEGER NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE booking_holds (
  id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id                       UUID NOT NULL UNIQUE REFERENCES bookings(id),
  hold_duration_hours_at_creation  INTEGER NOT NULL,
  expires_at                       TIMESTAMPTZ NOT NULL,
  released_at                      TIMESTAMPTZ,
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ STAY PREPARATION / SLEEPING PLAN ============
CREATE TABLE stay_preparations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           UUID NOT NULL REFERENCES properties(id),
  booking_id            UUID UNIQUE REFERENCES bookings(id),
  external_event_id     UUID UNIQUE REFERENCES external_calendar_events(id),
  adults                INTEGER NOT NULL DEFAULT 0,
  children              INTEGER NOT NULL DEFAULT 0,
  infants               INTEGER NOT NULL DEFAULT 0,
  plan_source           TEXT NOT NULL DEFAULT 'auto' CHECK (plan_source IN ('auto','admin_override')),
  comment_for_cleaner   TEXT,
  expected_arrival_time TIME,
  updated_by_user_id    UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((booking_id IS NULL) <> (external_event_id IS NULL))
);

CREATE TABLE stay_sleeping_plan (
  stay_preparation_id UUID NOT NULL REFERENCES stay_preparations(id) ON DELETE CASCADE,
  bed_id              UUID NOT NULL REFERENCES beds(id),
  persons             INTEGER NOT NULL CHECK (persons >= 1),
  guest_type          TEXT NOT NULL DEFAULT 'adult' CHECK (guest_type IN ('adult','child','infant','mixed')),
  PRIMARY KEY (stay_preparation_id, bed_id)
);

-- ============ PAYMENTS ============
CREATE TABLE payment_method_settings (
  method              TEXT PRIMARY KEY CHECK (method IN ('stripe_card','vipps','invoice')),
  enabled             BOOLEAN NOT NULL DEFAULT true,
  updated_by_user_id  UUID REFERENCES users(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID NOT NULL REFERENCES bookings(id),
  method              TEXT NOT NULL CHECK (method IN ('stripe_card','vipps','invoice')),
  provider            TEXT NOT NULL,                  -- 'stripe' | 'vipps' | 'invoice' | 'mock'
  provider_reference  TEXT UNIQUE,
  checkout_url        TEXT,
  amount_ore          INTEGER NOT NULL CHECK (amount_ore >= 0),
  refunded_amount_ore INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'NOK',
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','succeeded','failed','cancelled','refunded','partially_refunded')),
  idempotency_key     TEXT UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_booking ON payments (booking_id);
-- At most one successful initial payment per booking
CREATE UNIQUE INDEX uq_payment_success_per_booking ON payments (booking_id) WHERE status IN ('succeeded','partially_refunded','refunded');

CREATE TABLE invoices (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id             UUID NOT NULL UNIQUE REFERENCES payments(id),
  invoice_number         TEXT NOT NULL UNIQUE,
  kid_number             TEXT NOT NULL UNIQUE,
  amount_ore             INTEGER NOT NULL,
  due_date               DATE NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','paid','overdue','cancelled')),
  sent_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  marked_paid_by_user_id UUID REFERENCES users(id),
  marked_paid_at         TIMESTAMPTZ
);

CREATE TABLE refunds (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id           UUID NOT NULL REFERENCES payments(id),
  amount_ore           INTEGER NOT NULL CHECK (amount_ore > 0),
  reason               TEXT NOT NULL CHECK (reason IN
                         ('cancellation_tier','admin_cancellation','timeout_auto_approval',
                          'membership_revoked','goodwill','conflict_auto_refund')),
  policy_tier_id       UUID REFERENCES cancellation_policy_tiers(id),
  initiated_by_user_id UUID REFERENCES users(id),
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
  provider_reference   TEXT,
  error                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every inbound webhook (payment or channel) is recorded once; replays are ignored.
CREATE TABLE webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  error         TEXT,
  UNIQUE (provider, event_id)
);

-- ============ REWARDS ============
CREATE TABLE reward_credits (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id),
  referral_id            UUID REFERENCES referrals(id),
  source                 TEXT NOT NULL DEFAULT 'referral' CHECK (source IN ('referral','manual_adjustment')),
  role_in_referral       TEXT CHECK (role_in_referral IN ('referrer','referred')),
  amount_ore             INTEGER NOT NULL CHECK (amount_ore > 0),
  remaining_amount_ore   INTEGER NOT NULL CHECK (remaining_amount_ore >= 0),
  granted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  vests_at               TIMESTAMPTZ NOT NULL,
  expires_at             TIMESTAMPTZ NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending_vest' CHECK (status IN
                           ('pending_vest','available','partially_used','fully_used','expired','revoked')),
  note                   TEXT,
  granted_by_user_id     UUID REFERENCES users(id),
  revoked_by_user_id     UUID REFERENCES users(id),
  revoked_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (remaining_amount_ore <= amount_ore),
  CHECK ((source = 'referral') = (referral_id IS NOT NULL))
);
-- A referral can produce exactly one credit per party — repeated webhooks/status changes can never duplicate.
CREATE UNIQUE INDEX uq_reward_per_referral_party ON reward_credits (referral_id, role_in_referral) WHERE referral_id IS NOT NULL;
CREATE INDEX idx_reward_credits_user ON reward_credits (user_id, status);

CREATE TABLE reward_redemptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_credit_id    UUID NOT NULL REFERENCES reward_credits(id),
  booking_id          UUID NOT NULL REFERENCES bookings(id),
  amount_applied_ore  INTEGER NOT NULL CHECK (amount_applied_ore > 0),
  reversed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ledger shown to members as "transaction history"
CREATE TABLE reward_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  reward_credit_id  UUID REFERENCES reward_credits(id),
  booking_id        UUID REFERENCES bookings(id),
  kind              TEXT NOT NULL CHECK (kind IN ('granted','vested','redeemed','redemption_reversed','expired','revoked','adjusted')),
  amount_ore        INTEGER NOT NULL,                 -- signed: + adds to balance, - reduces
  note              TEXT,
  actor_user_id     UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reward_tx_user ON reward_transactions (user_id, created_at DESC);

-- ============ CLEANING ============
CREATE TABLE helper_property_assignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_user_id      UUID NOT NULL REFERENCES users(id),
  property_id         UUID NOT NULL REFERENCES properties(id),
  active              BOOLEAN NOT NULL DEFAULT true,
  assigned_by_user_id UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_helper_property_active ON helper_property_assignments (helper_user_id, property_id) WHERE active;

CREATE TABLE cleaning_tasks (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id            UUID NOT NULL REFERENCES properties(id),
  task_type              TEXT NOT NULL DEFAULT 'turnover' CHECK (task_type IN ('turnover','preparation')),
  source_type            TEXT NOT NULL CHECK (source_type IN ('platform_booking','external_event','manual')),
  booking_id             UUID REFERENCES bookings(id),
  external_event_id      UUID REFERENCES external_calendar_events(id),
  channel_name           TEXT NOT NULL,
  checkout_date          DATE NOT NULL,                  -- the day the cleaning happens
  checkout_guests        INTEGER,
  next_checkin_date      DATE,
  next_preparation_id    UUID REFERENCES stay_preparations(id),
  deadline_at            TIMESTAMPTZ,                    -- next check-in time, if known
  status                 TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','assigned','in_progress','done','cancelled','not_needed')),
  not_needed_reason      TEXT,
  assigned_to_user_id    UUID REFERENCES users(id),
  notes                  TEXT,                           -- admin instructions to cleaner
  started_at             TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,
  completed_by_user_id   UUID REFERENCES users(id),
  completion_notes       TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((source_type = 'platform_booking') = (booking_id IS NOT NULL)),
  CHECK ((source_type = 'external_event') = (external_event_id IS NOT NULL)),
  CHECK (status <> 'done' OR completed_at IS NOT NULL)
);
CREATE UNIQUE INDEX uq_cleaning_task_booking  ON cleaning_tasks (booking_id, task_type) WHERE booking_id IS NOT NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX uq_cleaning_task_external ON cleaning_tasks (external_event_id, task_type) WHERE external_event_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX idx_cleaning_tasks_schedule ON cleaning_tasks (property_id, checkout_date);

CREATE TABLE room_preparation_status (
  cleaning_task_id   UUID NOT NULL REFERENCES cleaning_tasks(id),
  room_id            UUID NOT NULL REFERENCES rooms(id),
  completed_at       TIMESTAMPTZ,
  completed_by_user_id UUID REFERENCES users(id),
  PRIMARY KEY (cleaning_task_id, room_id)
);

CREATE TABLE cleaning_reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_task_id   UUID REFERENCES cleaning_tasks(id),
  property_id        UUID NOT NULL REFERENCES properties(id),
  kind               TEXT NOT NULL CHECK (kind IN ('damage','missing_item','issue','comment')),
  description        TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  resolved_at        TIMESTAMPTZ,
  resolved_by_user_id UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE photos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type        TEXT NOT NULL CHECK (entity_type IN ('cleaning_task','cleaning_report','room','property')),
  entity_id          UUID NOT NULL,
  storage_key        TEXT NOT NULL UNIQUE,
  mime_type          TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes         INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_photos_entity ON photos (entity_type, entity_id);

-- ============ CONFIG, AUDIT, NOTIFICATIONS ============
CREATE TABLE platform_settings (
  key                 TEXT PRIMARY KEY,
  value               TEXT NOT NULL,
  updated_by_user_id  UUID REFERENCES users(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   UUID REFERENCES users(id),
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('admin','member','helper','system','anonymous')),
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  before_state    JSONB,
  after_state     JSONB,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_log_created ON audit_log (created_at DESC);
-- Append-only: block UPDATE/DELETE at the database level (retention purge runs as a privileged maintenance role)
CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_audit_purge', true) = 'on' AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'audit_log is append-only';
END $$;
CREATE TRIGGER trg_audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- Outbox: one row per message per channel; a worker delivers them. SMS/push slot in as new channels.
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  to_address  TEXT NOT NULL,
  type        TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','push')),
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  payload     JSONB,
  dedupe_key  TEXT UNIQUE,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_queued ON notifications (created_at) WHERE status = 'queued';

CREATE TABLE job_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job         TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failure')),
  detail      JSONB
);
