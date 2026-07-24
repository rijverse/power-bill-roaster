CREATE TABLE "identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_uid" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_uid_idx" ON "identities" USING btree ("provider","provider_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_user_provider_idx" ON "identities" USING btree ("user_id","provider");--> statement-breakpoint
-- Backfill one identity row per connected provider from the legacy users columns.
-- drizzle-kit only diffs DDL, so this data migration is hand-written. Safe because
-- the source columns are already globally unique and at-most-one-per-user, so both
-- uniques above hold.
INSERT INTO "identities" ("user_id", "provider", "provider_uid", "verified", "created_at")
SELECT "id", 'telegram', "telegram_chat_id"::text, true, "created_at" FROM "users" WHERE "telegram_chat_id" IS NOT NULL
UNION ALL
SELECT "id", 'discord', "discord_user_id", true, "created_at" FROM "users" WHERE "discord_user_id" IS NOT NULL
UNION ALL
SELECT "id", 'email', lower("email"), true, "created_at" FROM "users" WHERE "email" IS NOT NULL;