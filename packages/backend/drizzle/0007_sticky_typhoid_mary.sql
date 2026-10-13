-- oxy:deploy-phase=pre
-- Nested folders: a parent column, and names unique per parent rather than per user.
-- Only loosens the old constraint, so the previous release keeps working against it.

DROP INDEX "folders_oxy_user_id_name_idx";--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "parent_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_oxy_user_id_parent_name_idx" ON "folders" USING btree ("oxy_user_id",coalesce("parent_id", ''),"name");