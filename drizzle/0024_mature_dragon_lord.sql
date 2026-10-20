CREATE TABLE `codex_inventory_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`nonce` text NOT NULL,
	`fingerprint` text NOT NULL,
	`request_json` text NOT NULL,
	`receipt_json` text NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `codex_inventory_state` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL
);
