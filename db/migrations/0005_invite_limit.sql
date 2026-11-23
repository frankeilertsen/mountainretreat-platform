-- Members may send at most this many invitations per rolling 7 days (adjustable under Admin → Bonus)
INSERT INTO platform_settings (key, value) VALUES ('invitation_weekly_limit', '50') ON CONFLICT (key) DO NOTHING;
CREATE INDEX IF NOT EXISTS idx_invitations_inviter_created ON invitations (inviter_user_id, created_at);
