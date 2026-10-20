ALTER TABLE `session_threads` ADD `mirror_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session_threads` ADD `last_import_id` text;