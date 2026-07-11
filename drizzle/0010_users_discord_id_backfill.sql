-- users.discord_user_id originally landed by editing the already-applied 0000
-- migration, which drizzle's migrator never re-runs (it skips by created_at),
-- so databases migrated before the Discord launch never got the column. This
-- migration converges both worlds: a no-op on fresh databases (0000 already
-- created the column), the missing ALTER on existing ones.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discord_user_id" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_discord_user_id_unique'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_discord_user_id_unique" UNIQUE("discord_user_id");
  END IF;
END $$;
