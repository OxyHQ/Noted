-- oxy:deploy-phase=pre
-- Version history for a note's own text (title, body, checklist).

CREATE TABLE "note_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"note_id" text NOT NULL,
	"oxy_user_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_revisions_note_idx" ON "note_revisions" USING btree ("note_id","created_at" DESC NULLS LAST);