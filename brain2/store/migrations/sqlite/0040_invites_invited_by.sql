-- 0040_invites_invited_by: retain who issued an invite for notifications.

ALTER TABLE invites ADD COLUMN invited_by TEXT;
