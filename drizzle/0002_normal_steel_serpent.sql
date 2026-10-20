CREATE TABLE `event_subscriptions` (
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`callback_url` text NOT NULL,
	`signing_secret` text NOT NULL,
	`previous_secret` text,
	`rotation_until` integer,
	`expires_at` integer NOT NULL,
	`verified_at` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`trial_message_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`accepted_at` integer,
	PRIMARY KEY(`owner_id`, `project_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_subscription_id_owner` ON `event_subscriptions` (`owner_id`,`subscription_id`);