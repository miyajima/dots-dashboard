CREATE TABLE `request_results` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source_message_id` text NOT NULL,
	`reply_message_id` text NOT NULL,
	`status` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`observed_at` text NOT NULL,
	`evidence_json` text NOT NULL,
	`fingerprint` text NOT NULL,
	`recorded_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `request_result_reply` ON `request_results` (`owner_id`,`reply_message_id`);--> statement-breakpoint
CREATE INDEX `request_results_source` ON `request_results` (`owner_id`,`project_id`,`source_message_id`);