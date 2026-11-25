-- "Vasker selv" for a single booking: no cleaning fee (if set before approval) and no cleaning job.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaning_self boolean NOT NULL DEFAULT false;
