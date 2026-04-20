import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

const now = () => sql`(unixepoch() * 1000)`

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'timestamp_ms' }),
  image: text('image'),
})

export const accounts = sqliteTable('accounts', {
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('providerAccountId').notNull(),
  refresh_token: text('refresh_token'),
  access_token: text('access_token'),
  expires_at: integer('expires_at'),
  token_type: text('token_type'),
  scope: text('scope'),
  id_token: text('id_token'),
  session_state: text('session_state'),
}, (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })])

export const sessions = sqliteTable('sessions', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
})

export const verificationTokens = sqliteTable('verificationTokens', {
  identifier: text('identifier').notNull(),
  token: text('token').notNull(),
  expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [primaryKey({ columns: [t.identifier, t.token] })])

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).default(now()),
})

export const organizationMembers = sqliteTable('organization_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('orgId').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull().default('member'),
})

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('orgId').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).default(now()),
})

export const driveConnections = sqliteTable('drive_connections', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text('teamId').notNull().unique().references(() => teams.id, { onDelete: 'cascade' }),
  userId: text('userId').notNull().references(() => users.id),
  folderId: text('folderId').notNull(),
  folderName: text('folderName').notNull(),
  accessToken: text('accessToken').notNull(),
  refreshToken: text('refreshToken').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }),
})

export const players = sqliteTable('players', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text('teamId').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  folderName: text('folderName').notNull(),
})

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text('teamId').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status', { enum: ['draft', 'rendering', 'complete', 'failed'] }).notNull().default('draft'),
  imagesPerPlayer: integer('imagesPerPlayer').notNull().default(4),
  secondsPerImage: real('secondsPerImage').notNull().default(3.5),
  audioR2Key: text('audioR2Key'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).default(now()),
})

export const playlistItems = sqliteTable('playlist_items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text('projectId').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  playerId: text('playerId').notNull().references(() => players.id),
  driveFileId: text('driveFileId').notNull(),
  thumbnailUrl: text('thumbnailUrl'),
  exifDate: integer('exifDate', { mode: 'timestamp_ms' }),
  position: integer('position').notNull(),
  durationOverride: real('durationOverride'),
})

export const renderJobs = sqliteTable('render_jobs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text('projectId').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['pending', 'running', 'complete', 'failed'] }).notNull().default('pending'),
  githubRunId: integer('githubRunId'),
  outputDriveFileId: text('outputDriveFileId'),
  errorMsg: text('errorMsg'),
  callbackSecret: text('callbackSecret').notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).default(now()),
  completedAt: integer('completedAt', { mode: 'timestamp_ms' }),
})
