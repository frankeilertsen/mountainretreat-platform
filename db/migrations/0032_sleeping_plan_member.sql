-- Members choose who sleeps where; partial own bed linen (number of guests bringing their own)
ALTER TABLE stay_preparations DROP CONSTRAINT IF EXISTS stay_preparations_plan_source_check;
ALTER TABLE stay_preparations ADD CONSTRAINT stay_preparations_plan_source_check CHECK (plan_source IN ('auto','admin_override','member'));
ALTER TABLE stay_preparations ADD COLUMN own_linen_persons INTEGER NOT NULL DEFAULT 0 CHECK (own_linen_persons >= 0);
ALTER TABLE stay_sleeping_plan ADD COLUMN linen BOOLEAN NOT NULL DEFAULT true;   -- false = the guest brings own linen for this bed
ALTER TABLE bookings ADD COLUMN own_linen_persons INTEGER NOT NULL DEFAULT 0 CHECK (own_linen_persons >= 0);
ALTER TABLE bookings ADD COLUMN sleep_plan_requested_at TIMESTAMPTZ, ADD COLUMN sleep_plan_reminded_at TIMESTAMPTZ;
-- Existing "own linen" bookings meant everyone
UPDATE bookings SET own_linen_persons = adults + children WHERE own_linen;
UPDATE stay_preparations SET own_linen_persons = adults + children WHERE own_linen;
