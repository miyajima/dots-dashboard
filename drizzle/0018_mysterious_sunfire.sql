CREATE TABLE `codex_project_catalog` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`projects_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`codex_project_id` text,
	`environment_id` text,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_project_client` ON `user_projects` (`owner_id`,`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_project_name` ON `user_projects` (`owner_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `user_projects_owner` ON `user_projects` (`owner_id`,`created_at`);