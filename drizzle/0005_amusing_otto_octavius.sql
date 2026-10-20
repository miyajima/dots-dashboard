CREATE TABLE `event_subscription_stops` (
	`owner_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`stopped_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `subscription_id`)
);
