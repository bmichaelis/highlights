-- Clear data tied to old schema (players and playlist_items reference the old teamId FK)
DELETE FROM `playlist_items`;
--> statement-breakpoint
DELETE FROM `players`;
--> statement-breakpoint
-- Recreate players table with projectId instead of teamId
CREATE TABLE `players_new` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`folderName` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `players`;
--> statement-breakpoint
ALTER TABLE `players_new` RENAME TO `players`;
--> statement-breakpoint
-- Add folder columns to projects (nullable — existing projects have no folder yet)
ALTER TABLE `projects` ADD COLUMN `folderId` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `folderName` text;
--> statement-breakpoint
-- Remove folder columns from drive_connections
ALTER TABLE `drive_connections` DROP COLUMN `folderId`;
--> statement-breakpoint
ALTER TABLE `drive_connections` DROP COLUMN `folderName`;
