CREATE TABLE `session_visibility` (
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`hidden` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `project_id`, `session_id`)
);
