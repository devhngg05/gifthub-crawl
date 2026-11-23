CREATE EXTENSION IF NOT EXISTS "pg_trgm";
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetched_count" integer DEFAULT 0 NOT NULL,
	"ai_processed_count" integer DEFAULT 0 NOT NULL,
	"updated_stars_only" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"error_summary" text
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_id" bigint NOT NULL,
	"name" varchar(255) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"html_url" text NOT NULL,
	"stars" integer DEFAULT 0 NOT NULL,
	"language" varchar(100),
	"last_pushed_at" timestamp with time zone NOT NULL,
	"readme_sha" varchar(64),
	"summary_vi" text NOT NULL,
	"category" varchar(100) NOT NULL,
	"sub_category" varchar(100) NOT NULL,
	"secondary_sub_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"use_cases" text[] DEFAULT '{}'::text[] NOT NULL,
	"replaces" text[] DEFAULT '{}'::text[] NOT NULL,
	"usability" varchar(50) NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"user_notes" text,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tools_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE INDEX "sync_logs_ran_at_idx" ON "sync_logs" USING btree ("ran_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tools_category_idx" ON "tools" USING btree ("category");--> statement-breakpoint
CREATE INDEX "tools_sub_category_idx" ON "tools" USING btree ("sub_category");--> statement-breakpoint
CREATE INDEX "tools_stars_idx" ON "tools" USING btree ("stars");--> statement-breakpoint
CREATE INDEX "tools_secondary_sub_categories_gin_idx" ON "tools" USING gin ("secondary_sub_categories");--> statement-breakpoint
CREATE INDEX "tools_use_cases_gin_idx" ON "tools" USING gin ("use_cases");--> statement-breakpoint
CREATE INDEX "tools_replaces_gin_idx" ON "tools" USING gin ("replaces");--> statement-breakpoint
CREATE INDEX "tools_search_text_trgm_idx" ON "tools" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tools_pinned_stars_pushed_idx" ON "tools" USING btree ("is_pinned" DESC NULLS LAST,"stars" DESC NULLS LAST,"last_pushed_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tools_last_pushed_at_idx" ON "tools" USING btree ("last_pushed_at" DESC NULLS LAST,"stars" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tools_created_at_idx" ON "tools" USING btree ("created_at" DESC NULLS LAST);