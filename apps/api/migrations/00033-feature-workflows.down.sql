DROP TABLE IF EXISTS streak_freeze_log;
ALTER TABLE users DROP COLUMN IF EXISTS streak_freeze_tokens;
DROP TABLE IF EXISTS push_subscriptions;
DROP TABLE IF EXISTS brand_question_bank;
