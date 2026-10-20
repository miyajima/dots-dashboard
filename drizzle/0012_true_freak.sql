CREATE TABLE `project_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`client_id` text NOT NULL,
	`title` text NOT NULL,
	`purpose` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_client` ON `project_sessions` (`owner_id`,`project_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `session_project` ON `project_sessions` (`owner_id`,`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `session_deliveries` (
	`owner_id` text NOT NULL,
	`message_id` text NOT NULL,
	`session_id` text NOT NULL,
	`room_id` text NOT NULL,
	`root_ref` text NOT NULL,
	`external_message_id` text NOT NULL,
	`sent_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`owner_id`, `message_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_external_message` ON `session_deliveries` (`owner_id`,`room_id`,`external_message_id`);--> statement-breakpoint
CREATE TABLE `session_mirror_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`room_id` text NOT NULL,
	`message_id` text NOT NULL,
	`canonical_ref` text,
	`reply_to_ref` text,
	`root_ref` text NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`mode` text NOT NULL,
	`original_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`unresolved_parent` integer NOT NULL,
	`fingerprint` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mirror_original_message` ON `session_mirror_messages` (`owner_id`,`room_id`,`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mirror_canonical_ref` ON `session_mirror_messages` (`owner_id`,`room_id`,`canonical_ref`);--> statement-breakpoint
CREATE INDEX `mirror_session` ON `session_mirror_messages` (`owner_id`,`project_id`,`session_id`,`original_at`);--> statement-breakpoint
CREATE TABLE `session_threads` (
	`owner_id` text NOT NULL,
	`session_id` text NOT NULL,
	`project_id` text NOT NULL,
	`room_id` text NOT NULL,
	`root_ref` text NOT NULL,
	`root_message_id` text NOT NULL,
	`source_message_id` text NOT NULL,
	`created_at` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`owner_id`, `session_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_thread_root` ON `session_threads` (`owner_id`,`room_id`,`root_ref`);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `session_id` text;