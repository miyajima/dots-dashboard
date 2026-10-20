CREATE TABLE `agent_team_dispatches` (
	`owner_id` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`team_id` text NOT NULL,
	`step_id` text NOT NULL,
	`generation` integer NOT NULL,
	`intent_json` text NOT NULL,
	PRIMARY KEY(`owner_id`, `dispatch_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_dispatch_generation` ON `agent_team_dispatches` (`owner_id`,`team_id`,`step_id`,`generation`);