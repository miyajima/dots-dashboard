CREATE TABLE `session_external_claims` (
	`owner_id` text NOT NULL,
	`room_id` text NOT NULL,
	`claim_key` text NOT NULL,
	`direction` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`owner_id`, `room_id`, `claim_key`)
);
