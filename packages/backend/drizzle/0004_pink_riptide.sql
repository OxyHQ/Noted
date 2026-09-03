-- oxy:deploy-phase=pre
-- Make the user-visible reminder notification idempotent across event retries.

ALTER TABLE "notifications" ADD COLUMN "source_event_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_source_event_id_key" UNIQUE("source_event_id");
