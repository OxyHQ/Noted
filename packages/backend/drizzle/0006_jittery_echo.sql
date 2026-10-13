-- oxy:deploy-phase=pre
-- Folders: a place to file notes. Additive: a nullable column and a new table.

CREATE TABLE "folders" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "folder_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_oxy_user_id_name_idx" ON "folders" USING btree ("oxy_user_id","name");--> statement-breakpoint
CREATE INDEX "notes_folder_idx" ON "notes" USING btree ("oxy_user_id","folder_id");