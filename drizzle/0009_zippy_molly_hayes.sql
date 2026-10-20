CREATE TABLE `chat_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`client_id` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`state` text DEFAULT 'uploading' NOT NULL,
	`created_at` text NOT NULL,
	`ready_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_upload_client` ON `chat_attachments` (`owner_id`,`project_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `attachments_by_owner_project` ON `chat_attachments` (`owner_id`,`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `mode` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `skill_references_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `attachment_ids_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `chat_reply_receipt` ON `chat_messages` (`owner_id`,`project_id`,`reply_to`,`author`,`created_at`);