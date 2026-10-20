CREATE TABLE `project_status_records` (
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`source_message_id` text NOT NULL,
	`summary` text NOT NULL,
	`achievement` text NOT NULL,
	`blocker` text NOT NULL,
	`next_step` text NOT NULL,
	`observed_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`evidence_json` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`owner_id`, `project_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_status_operation` ON `project_status_records` (`owner_id`,`operation_id`);