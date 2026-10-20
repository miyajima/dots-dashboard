CREATE TABLE `task_plan_imports` (
	`owner_id` text NOT NULL,
	`parent_task_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`owner_id`, `parent_task_id`, `plan_id`)
);
