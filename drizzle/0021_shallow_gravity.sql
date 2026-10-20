CREATE TABLE `agent_team_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`team_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`snapshot_json` text NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `agent_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`last_operation_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_team_task` ON `agent_teams` (`owner_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `agent_team_project` ON `agent_teams` (`owner_id`,`project_id`);