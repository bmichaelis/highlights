CREATE TABLE `accounts` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `drive_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`userId` text NOT NULL,
	`folderId` text NOT NULL,
	`folderName` text NOT NULL,
	`accessToken` text NOT NULL,
	`refreshToken` text NOT NULL,
	`expiresAt` integer,
	FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drive_connections_teamId_unique` ON `drive_connections` (`teamId`);--> statement-breakpoint
CREATE TABLE `organization_members` (
	`id` text PRIMARY KEY NOT NULL,
	`orgId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	FOREIGN KEY (`orgId`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`name` text NOT NULL,
	`folderName` text NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `playlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`playerId` text NOT NULL,
	`driveFileId` text NOT NULL,
	`thumbnailUrl` text,
	`exifDate` integer,
	`position` integer NOT NULL,
	`durationOverride` real,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`playerId`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`imagesPerPlayer` integer DEFAULT 4 NOT NULL,
	`secondsPerImage` real DEFAULT 3.5 NOT NULL,
	`audioR2Key` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000),
	FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `render_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`githubRunId` integer,
	`outputDriveFileId` text,
	`errorMsg` text,
	`callbackSecret` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000),
	`completedAt` integer,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`orgId` text NOT NULL,
	`name` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000),
	FOREIGN KEY (`orgId`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`emailVerified` integer,
	`image` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verificationTokens` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
