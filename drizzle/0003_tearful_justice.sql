CREATE TABLE `event_deliveries` (
	`owner_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`message_id` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `subscription_id`, `message_id`)
);
