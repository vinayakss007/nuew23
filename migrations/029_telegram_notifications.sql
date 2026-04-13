-- 029_telegram_notifications.sql
-- Add Telegram notification columns to users table

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS telegram_bot_token text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS telegram_chat_id text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS telegram_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS telegram_notify_login boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS telegram_notify_signup boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS telegram_notify_password_change boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS telegram_notify_2fa_change boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS telegram_notify_security_alerts boolean DEFAULT true;

-- Index for fast lookup of users with Telegram enabled
CREATE INDEX IF NOT EXISTS idx_users_telegram_enabled
  ON public.users(telegram_enabled)
  WHERE telegram_enabled = true;

COMMENT ON COLUMN public.users.telegram_bot_token IS 'User''s Telegram bot token from @BotFather';
COMMENT ON COLUMN public.users.telegram_chat_id IS 'Chat ID where bot sends notifications';
COMMENT ON COLUMN public.users.telegram_enabled IS 'Whether Telegram notifications are active';
COMMENT ON COLUMN public.users.telegram_notify_login IS 'Notify on successful login';
COMMENT ON COLUMN public.users.telegram_notify_signup IS 'Notify on new account signup';
COMMENT ON COLUMN public.users.telegram_notify_password_change IS 'Notify on password change';
COMMENT ON COLUMN public.users.telegram_notify_2fa_change IS 'Notify on 2FA enable/disable';
COMMENT ON COLUMN public.users.telegram_notify_security_alerts IS 'Notify on security events';
