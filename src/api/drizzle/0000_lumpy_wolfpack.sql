CREATE TABLE `searches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`query` text NOT NULL,
	`results` text NOT NULL,
	`created_at` integer NOT NULL
);
