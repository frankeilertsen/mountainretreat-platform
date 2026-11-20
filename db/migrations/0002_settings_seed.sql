-- Admin-editable defaults (never hardcoded in application logic)
INSERT INTO platform_settings (key, value) VALUES
  ('booking_hold_duration_hours', '48'),
  ('invoice_due_date_days', '14'),
  ('cancellation_approval_timeout_hours', '48'),
  ('ical_poll_interval_minutes', '30'),
  ('ical_failure_alert_threshold', '3'),
  ('invitation_validity_days', '10'),
  ('referral_reward_type', 'fixed'),          -- 'fixed' | 'percentage'
  ('referral_reward_referrer_ore', '50000'),  -- 500 kr when fixed
  ('referral_reward_referred_ore', '50000'),
  ('referral_reward_percentage', '10'),       -- % of the qualifying stay's price when percentage
  ('referral_reward_max_ore', '100000'),      -- cap for percentage rewards
  ('referral_reward_vesting_days', '7'),
  ('referral_reward_validity_days', '730'),
  ('referral_min_qualifying_amount_ore', '100000'), -- stay must be worth at least 1000 kr to qualify
  ('audit_log_retention_days', '365'),
  ('notification_log_retention_days', '365'),
  ('short_turnaround_hours', '6'),
  ('invoice_bank_account', '0000.00.00000'),
  ('company_name', 'FKE Property AS'),
  ('member_base_discount_pct', '5'),        -- standard member discount on the stay price
  ('member_loyalty_step_pct', '1'),         -- extra % per booking made
  ('member_loyalty_max_pct', '10'),         -- cap for the extra loyalty discount
  ('cleaning_same_day_reminder_hour', '7')  -- local hour for the same-day cleaning reminder
ON CONFLICT (key) DO NOTHING;

INSERT INTO payment_method_settings (method, enabled) VALUES
  ('stripe_card', true), ('vipps', false), ('invoice', true)
ON CONFLICT DO NOTHING;

-- Platform-wide default cancellation tiers
INSERT INTO cancellation_policy_tiers (property_id, days_before_checkin_min, days_before_checkin_max, refund_percentage, requires_admin_approval)
VALUES (NULL, 30, NULL, 100, false),
       (NULL, 10, 29, 50, false),
       (NULL, 0, 9, 0, true);
