CREATE TABLE "pending_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"meter_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"action" text NOT NULL,
	"level" text NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pending_alerts" ADD CONSTRAINT "pending_alerts_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_alerts" ADD CONSTRAINT "pending_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_alerts_status_next_idx" ON "pending_alerts" USING btree ("status","next_attempt");--> statement-breakpoint
CREATE INDEX "pending_alerts_meter_idx" ON "pending_alerts" USING btree ("meter_id");