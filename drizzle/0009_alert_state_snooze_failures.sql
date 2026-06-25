ALTER TABLE "alert_state" ADD COLUMN "reminders_snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_state" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_state" ADD COLUMN "failure_notified_at" timestamp with time zone;