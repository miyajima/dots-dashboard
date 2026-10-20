CREATE TABLE `external_request_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`origin` text NOT NULL,
	`room_id` text NOT NULL,
	`message_ref` text NOT NULL,
	`original_created_at` text NOT NULL,
	`text` text NOT NULL,
	`mode` text NOT NULL,
	`context_json` text NOT NULL,
	`content_sha256` text NOT NULL,
	`fingerprint` text NOT NULL,
	`recorded_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_source_origin` ON `external_request_sources` (`owner_id`,`origin`,`room_id`,`message_ref`);--> statement-breakpoint
CREATE INDEX `external_source_project` ON `external_request_sources` (`owner_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `task_source_links` (
	`owner_id` text NOT NULL,
	`task_id` text NOT NULL,
	`source_id` text NOT NULL,
	`relation` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `task_id`, `source_id`)
);
