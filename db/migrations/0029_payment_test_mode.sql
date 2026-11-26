-- Test payments (Stripe sandbox, Vipps test environment) are kept for history but left out of revenue figures.
ALTER TABLE payments ADD COLUMN test_mode BOOLEAN NOT NULL DEFAULT false;
-- Everything before go-live (26 Nov 2026) was testing
UPDATE payments SET test_mode = true WHERE created_at < '2026-11-26 21:50:00+00';
