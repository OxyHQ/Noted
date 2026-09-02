-- oxy:deploy-phase=pre
-- Additive retry receipts for catalog tools. The currently serving image does
-- not read this table, so it is safe to create before the capability rollout.

CREATE TABLE "capability_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"tool" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "capability_executions_account_tool_key" ON "capability_executions" USING btree ("oxy_user_id","tool","idempotency_key");--> statement-breakpoint
CREATE INDEX "capability_executions_created_at_idx" ON "capability_executions" USING btree ("created_at");
