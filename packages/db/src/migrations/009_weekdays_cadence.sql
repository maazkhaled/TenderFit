-- 009_weekdays_cadence.sql
--
-- Adds the "weekdays" cadence option to DigestFrequency. Fires Mon-Fri
-- only, skips Saturday and Sunday — useful for office digests that
-- shouldn't land in inboxes over the weekend.
--
-- Idempotent.

ALTER TYPE "DigestFrequency" ADD VALUE IF NOT EXISTS 'weekdays';
