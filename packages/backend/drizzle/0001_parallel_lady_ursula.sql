-- oxy:deploy-phase=pre
-- Adds two tables and nothing else: no column is dropped, renamed or narrowed,
-- and no existing row is touched. The image still serving does not know these
-- tables exist and does not need to, so this is safe to apply before rollout.

CREATE TABLE "note_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"note_id" text NOT NULL,
	"oxy_user_id" text NOT NULL,
	"capture_id" text NOT NULL,
	"profile" text DEFAULT 'auto' NOT NULL,
	"intent" text DEFAULT 'freeform' NOT NULL,
	"transcript_revision" integer DEFAULT 0 NOT NULL,
	"artifact_revision" integer DEFAULT 0 NOT NULL,
	"doc" jsonb DEFAULT '{"sections":[],"checklists":[],"openQuestions":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "note_artifacts_slot" UNIQUE("note_id","capture_id")
);
--> statement-breakpoint
CREATE TABLE "note_item_overrides" (
	"note_id" text NOT NULL,
	"oxy_user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"text" text,
	"checked" boolean,
	"removed" boolean DEFAULT false NOT NULL,
	"adopted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "note_item_overrides_note_id_item_id_pk" PRIMARY KEY("note_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "note_artifacts" ADD CONSTRAINT "note_artifacts_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_item_overrides" ADD CONSTRAINT "note_item_overrides_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_artifacts_by_note_idx" ON "note_artifacts" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "note_artifacts_sync_idx" ON "note_artifacts" USING btree ("oxy_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "note_item_overrides_by_note_idx" ON "note_item_overrides" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "note_item_overrides_sync_idx" ON "note_item_overrides" USING btree ("oxy_user_id","updated_at");