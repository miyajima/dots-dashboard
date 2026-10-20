CREATE TABLE `agent_team_approval_waits` (
	`owner_id` text NOT NULL,
	`approval_request_id` text NOT NULL,
	`team_id` text NOT NULL,
	`step_id` text NOT NULL,
	`wait_generation` integer NOT NULL,
	`dispatch_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`generation` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `approval_request_id`)
);
--> statement-breakpoint
ALTER TABLE `agent_team_dispatches` ADD `attempt_id` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `team_dispatch_attempt` ON `agent_team_dispatches` (`owner_id`,`attempt_id`);