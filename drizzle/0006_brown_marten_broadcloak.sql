CREATE TABLE `external_task_progress` (
	`owner_id` text NOT NULL,
	`task_id` text NOT NULL,
	`source_message_id` text NOT NULL,
	`external_task_ref` text NOT NULL,
	`observed_at` text NOT NULL,
	`state` text NOT NULL,
	`summary` text NOT NULL,
	`evidence_json` text NOT NULL,
	PRIMARY KEY(`owner_id`, `task_id`)
);
