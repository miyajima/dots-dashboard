CREATE TABLE `board_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source_message_id` text NOT NULL,
	`client_id` text NOT NULL,
	`title` text NOT NULL,
	`scope` text NOT NULL,
	`action` text NOT NULL,
	`state` text NOT NULL,
	`priority` integer NOT NULL,
	`priority_reason` text NOT NULL,
	`dependencies_json` text NOT NULL,
	`revision` integer NOT NULL,
	`fence` integer NOT NULL,
	`bound_task_ref` text,
	`result_json` text,
	`last_operation_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_client_unique` ON `board_tasks` (`owner_id`,`project_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `tasks_by_project` ON `board_tasks` (`owner_id`,`project_id`,`priority`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`client_id` text NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`reply_to` text,
	`task_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_client_unique` ON `chat_messages` (`owner_id`,`project_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `chat_by_project` ON `chat_messages` (`owner_id`,`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `event_outbox` (
	`event_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`message_id` text NOT NULL,
	`event_name` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_outbox_message_id_unique` ON `event_outbox` (`message_id`);--> statement-breakpoint
CREATE TABLE `project_visibility` (
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`hidden` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `project_id`)
);
--> statement-breakpoint
CREATE TABLE `task_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`task_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
