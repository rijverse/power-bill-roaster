CREATE TABLE "admin_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"target_user_id" integer,
	"detail" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
