ALTER TABLE `board_tasks` ADD `parent_task_id` text;--> statement-breakpoint
ALTER TABLE `board_tasks` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `board_tasks` ADD `completion_criteria` text;--> statement-breakpoint
ALTER TABLE `board_tasks` ADD `progress_mark` text DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE `board_tasks` ADD `progress_evidence_json` text;--> statement-breakpoint
ALTER TABLE `board_tasks` ADD `progress_verified_at` text;