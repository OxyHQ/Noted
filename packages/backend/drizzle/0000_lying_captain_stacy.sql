-- oxy:deploy-phase=pre
-- Creates every table from scratch; nothing is dropped, renamed or narrowed,
-- so it is safe to apply while the previous image is still serving.
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"kind" text DEFAULT 'note' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"color" text DEFAULT 'default' NOT NULL,
	"labels" text[] DEFAULT '{}' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"trashed" boolean DEFAULT false NOT NULL,
	"attachments" text[] DEFAULT '{}' NOT NULL,
	"reminder_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("notes"."title", '')), 'A') || setweight(to_tsvector('simple', coalesce("notes"."body", '')), 'B')) STORED
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"type" text NOT NULL,
	"rating" integer,
	"message" text NOT NULL,
	"email" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channels" text[] DEFAULT '{}' NOT NULL,
	"delivery_status" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"token" text NOT NULL,
	"device_id" text,
	"platform" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notes_feed_idx" ON "notes" USING btree ("oxy_user_id","trashed","archived","pinned" DESC NULLS LAST,"sort_order");--> statement-breakpoint
CREATE INDEX "notes_sync_idx" ON "notes" USING btree ("oxy_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "notes_reminder_idx" ON "notes" USING btree ("reminder_at") WHERE "notes"."reminder_sent_at" is null and "notes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "notes_labels_idx" ON "notes" USING gin ("labels");--> statement-breakpoint
CREATE INDEX "notes_search_idx" ON "notes" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "notes_deleted_at_idx" ON "notes" USING btree ("deleted_at") WHERE "notes"."deleted_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "labels_oxy_user_id_name_idx" ON "labels" USING btree ("oxy_user_id","name");--> statement-breakpoint
CREATE INDEX "feedback_oxy_user_id_created_at_idx" ON "feedback" USING btree ("oxy_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feedback_status_created_at_idx" ON "feedback" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_feed_idx" ON "notifications" USING btree ("oxy_user_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("oxy_user_id") WHERE "notifications"."status" in ('pending', 'sent');--> statement-breakpoint
CREATE INDEX "notifications_dismissed_at_idx" ON "notifications" USING btree ("dismissed_at") WHERE "notifications"."dismissed_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "push_tokens_oxy_user_id_token_idx" ON "push_tokens" USING btree ("oxy_user_id","token");--> statement-breakpoint
CREATE UNIQUE INDEX "web_push_subscriptions_oxy_user_id_endpoint_idx" ON "web_push_subscriptions" USING btree ("oxy_user_id","endpoint");