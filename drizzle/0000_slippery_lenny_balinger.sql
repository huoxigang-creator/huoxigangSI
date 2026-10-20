CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`project` text NOT NULL,
	`data` text NOT NULL,
	`created` text NOT NULL
);
