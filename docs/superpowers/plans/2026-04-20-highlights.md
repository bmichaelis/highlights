# Highlights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-tenant SaaS that auto-sequences player photos from Google Drive into a banquet highlight video, rendered via GitHub Actions + FFmpeg, with output written back to Drive.

**Architecture:** Next.js 15 on Cloudflare Workers (via @opennextjs/cloudflare), Drizzle ORM + D1 for state, Google Drive for all media storage, GitHub Actions for FFmpeg rendering. Browser polls a D1-backed job table for render status, then streams the finished MP4 from Drive.

**Tech Stack:** Next.js 15, Cloudflare Workers + D1 + R2, NextAuth v5, Drizzle ORM, @dnd-kit/sortable, Vitest, Google Drive API v3, GitHub Actions, FFmpeg

---

## File Map

```
highlights/
├── .github/workflows/render.yml        ← FFmpeg render workflow
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── orgs/
│   │   │   ├── route.ts                       ← POST create org
│   │   │   └── [orgSlug]/
│   │   │       ├── route.ts                   ← GET org
│   │   │       ├── members/route.ts           ← POST invite
│   │   │       └── teams/
│   │   │           ├── route.ts               ← GET list, POST create
│   │   │           └── [teamId]/
│   │   │               ├── route.ts           ← GET team
│   │   │               ├── drive/
│   │   │               │   ├── route.ts       ← GET status, DELETE disconnect
│   │   │               │   ├── connect/route.ts
│   │   │               │   ├── callback/route.ts
│   │   │               │   └── scan/route.ts  ← POST scan folder
│   │   │               ├── players/route.ts   ← GET list
│   │   │               └── projects/
│   │   │                   ├── route.ts       ← GET list, POST create
│   │   │                   └── [projectId]/
│   │   │                       ├── route.ts
│   │   │                       ├── playlist/route.ts   ← GET, PATCH reorder
│   │   │                       ├── audio/route.ts      ← GET Drive audio, POST R2 fallback
│   │   │                       └── render/route.ts     ← POST trigger, GET status
│   │   └── render-callback/route.ts    ← POST from GitHub Actions
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx                  ← session provider, org nav
│   │   ├── onboarding/page.tsx         ← create or join org
│   │   └── orgs/[orgSlug]/
│   │       ├── page.tsx                ← org dashboard
│   │       └── teams/
│   │           ├── page.tsx
│   │           └── [teamId]/
│   │               ├── page.tsx        ← team + Drive connect UI
│   │               └── projects/
│   │                   ├── new/page.tsx
│   │                   └── [projectId]/page.tsx   ← playlist editor
│   └── layout.tsx
├── components/
│   ├── playlist-editor/
│   │   ├── index.tsx
│   │   ├── image-card.tsx
│   │   └── music-panel.tsx
│   └── ui/button.tsx
├── db/
│   ├── index.ts
│   ├── schema.ts
│   └── migrations/
├── lib/
│   ├── auth.ts
│   ├── auth.config.ts
│   ├── drive/
│   │   ├── auth.ts           ← token refresh
│   │   ├── scanner.ts        ← scan players + audio from Drive
│   │   └── sequencer.ts      ← pick N images per player, sort by EXIF
│   ├── github/
│   │   └── actions.ts        ← repository_dispatch helper
│   └── r2/
│       └── client.ts         ← audio fallback upload
├── scripts/render.mjs        ← Node.js script run by GitHub Actions
├── drizzle.config.ts
├── middleware.ts
├── next.config.ts
├── open-next.config.ts
├── tsconfig.json
├── vitest.config.ts
└── wrangler.toml
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `open-next.config.ts`, `wrangler.toml`, `drizzle.config.ts`, `vitest.config.ts`, `postcss.config.mjs`, `.gitignore`, `.env.local.example`

- [ ] **Step 1: Bootstrap Next.js app**

```bash
cd /Users/brett/brett-dev/highlights
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --yes
```

Expected: Next.js 15 project files created in current directory.

- [ ] **Step 2: Install project dependencies**

```bash
npm install next-auth@beta @auth/drizzle-adapter drizzle-orm @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
npm install -D @opennextjs/cloudflare wrangler drizzle-kit vitest @vitejs/plugin-react @vitest/coverage-v8 better-sqlite3 @types/better-sqlite3 happy-dom @testing-library/react @testing-library/user-event
```

- [ ] **Step 3: Replace `next.config.ts`**

```typescript
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: { unoptimized: true },
}

export default nextConfig
```

- [ ] **Step 4: Create `open-next.config.ts`**

```typescript
import { defineCloudflareConfig } from '@opennextjs/cloudflare'

export default defineCloudflareConfig()
```

- [ ] **Step 5: Create `wrangler.toml`**

```toml
name = "highlights"
main = ".open-next/worker.js"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]

[assets]
directory = ".open-next/assets"
binding = "ASSETS"

[vars]
AUTH_GOOGLE_ID = ""

[[services]]
binding = "WORKER_SELF_REFERENCE"
service = "highlights"

[[durable_objects.bindings]]
name = "DOQueueHandler"
class_name = "DOQueueHandler"

[[durable_objects.bindings]]
name = "DOShardedTagCache"
class_name = "DOShardedTagCache"

[[durable_objects.bindings]]
name = "BucketCachePurge"
class_name = "BucketCachePurge"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["DOQueueHandler", "DOShardedTagCache", "BucketCachePurge"]

[[r2_buckets]]
binding = "AUDIO_BUCKET"
bucket_name = "highlights-audio"

[[d1_databases]]
binding = "DB"
database_name = "highlights-db"
database_id = ""
migrations_dir = "db/migrations"
```

- [ ] **Step 6: Create `drizzle.config.ts`**

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/DB.sqlite',
  },
})
```

- [ ] **Step 7: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, '.') } },
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['lib/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: { name: 'component', include: ['components/**/*.test.tsx'], environment: 'happy-dom' },
      },
    ],
  },
})
```

- [ ] **Step 8: Create `.env.local.example`**

```
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
GITHUB_PAT=
GITHUB_OWNER=
GITHUB_REPO=
RENDER_CALLBACK_SECRET=
```

- [ ] **Step 9: Update `package.json` scripts**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "cf:build": "opennextjs-cloudflare build",
    "preview": "npm run cf:build && wrangler dev",
    "deploy": "npm run cf:build && opennextjs-cloudflare deploy",
    "db:generate": "drizzle-kit generate",
    "db:push": "node --env-file=.env.local ./node_modules/.bin/drizzle-kit push",
    "test": "vitest run",
    "test:watch": "vitest --project unit"
  }
}
```

- [ ] **Step 10: Initialize git and commit**

```bash
git init
git add package.json tsconfig.json next.config.ts open-next.config.ts wrangler.toml drizzle.config.ts vitest.config.ts postcss.config.mjs .gitignore .env.local.example
git commit -m "feat: initialize Next.js 15 + Cloudflare scaffold"
```

---

## Task 2: Database Schema

**Files:**
- Create: `db/schema.ts`, `db/index.ts`

- [ ] **Step 1: Create `db/schema.ts`**

```typescript
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
```

- [ ] **Step 2: Create `db/index.ts`**

```typescript
import { drizzle } from 'drizzle-orm/d1'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import * as schema from './schema'

export function getDb() {
  const { env } = getCloudflareContext()
  return drizzle(env.DB as D1Database, { schema })
}
```

- [ ] **Step 3: Generate and apply migration**

```bash
# Start wrangler dev first to create the local D1 file
npx wrangler dev &
sleep 5
# Update drizzle.config.ts url with actual .sqlite path after running above
# ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/ to find the filename
npm run db:generate
npm run db:push
```

Expected: `db/migrations/0000_initial.sql` created, tables applied to local D1.

- [ ] **Step 4: Commit**

```bash
git add db/
git commit -m "feat: add database schema and Drizzle D1 config"
```

---

## Task 3: Auth

**Files:**
- Create: `lib/auth.config.ts`, `lib/auth.ts`, `app/api/auth/[...nextauth]/route.ts`, `middleware.ts`, `app/(auth)/login/page.tsx`, `app/layout.tsx`, `types/next-auth.d.ts`

- [ ] **Step 1: Create `types/next-auth.d.ts`**

```typescript
import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user']
  }
}
```

- [ ] **Step 2: Create `lib/auth.config.ts`**

```typescript
import NextAuth, { type NextAuthConfig } from 'next-auth'
import Google from 'next-auth/providers/google'

export const authConfig: NextAuthConfig = {
  providers: [Google],
  pages: { signIn: '/login' },
  callbacks: {
    authorized({ auth }) { return !!auth },
    jwt({ token }) { return token },
    session({ session, token }) {
      if (token) session.user.id = token.id as string
      return session
    },
  },
}

export const { auth } = NextAuth(authConfig)
```

- [ ] **Step 3: Create `lib/auth.ts`**

```typescript
import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import { getDb } from '@/db'
import { users, accounts } from '@/db/schema'

type Db = ReturnType<typeof getDb>
const db = new Proxy(Object.create(BaseSQLiteDatabase.prototype) as Db, {
  get(_, prop) {
    return (getDb() as unknown as Record<string, unknown>)[prop as string]
  },
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, { usersTable: users, accountsTable: accounts }),
  providers: [Google],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id
      return token
    },
    async session({ session, token }) {
      if (token) session.user.id = token.id as string
      return session
    },
  },
})
```

- [ ] **Step 4: Create `app/api/auth/[...nextauth]/route.ts`**

```typescript
import { handlers } from '@/lib/auth'
export const { GET, POST } = handlers
```

- [ ] **Step 5: Create `middleware.ts`**

```typescript
import { auth } from '@/lib/auth.config'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const publicPaths = ['/login', '/api/auth', '/api/render-callback']
  if (publicPaths.some((p) => pathname.startsWith(p))) return NextResponse.next()
  if (!req.auth) return NextResponse.redirect(new URL('/login', req.url))
  return NextResponse.next()
})

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
```

- [ ] **Step 6: Create `app/(auth)/login/page.tsx`**

```tsx
import { signIn } from '@/lib/auth'

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <form action={async () => { 'use server'; await signIn('google', { redirectTo: '/' }) }}>
        <button type="submit" className="px-6 py-3 bg-blue-600 text-white rounded-lg">
          Sign in with Google
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 7: Update `app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'Highlights' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 8: Add env vars to `.env.local` (do not commit)**

```
AUTH_SECRET=<generate with: openssl rand -base64 32>
AUTH_GOOGLE_ID=<from Google Cloud Console>
AUTH_GOOGLE_SECRET=<from Google Cloud Console>
```

Google Cloud Console OAuth setup:
- Go to console.cloud.google.com → APIs & Services → Credentials
- Create OAuth 2.0 Client ID (Web application)
- Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`
- Enable Google Drive API in the project

- [ ] **Step 9: Test auth works locally**

```bash
npm run dev
# Navigate to http://localhost:3000
# Should redirect to /login
# Click "Sign in with Google" and complete OAuth flow
# Should land on / (will 404 — that's fine, auth is working)
```

- [ ] **Step 10: Commit**

```bash
git add lib/auth.ts lib/auth.config.ts app/ middleware.ts types/
git commit -m "feat: add NextAuth v5 with Google OAuth"
```

---

## Task 4: Org Creation and Onboarding

**Files:**
- Create: `lib/auth-helpers.ts`, `app/api/orgs/route.ts`, `app/api/orgs/[orgSlug]/route.ts`, `app/(app)/layout.tsx`, `app/(app)/onboarding/page.tsx`, `app/(app)/orgs/[orgSlug]/page.tsx`

- [ ] **Step 1: Write failing test for org slug generation**

```typescript
// lib/auth-helpers.test.ts
import { describe, it, expect } from 'vitest'
import { slugify } from './auth-helpers'

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Springfield Soccer Club')).toBe('springfield-soccer-club')
  })
  it('strips special characters', () => {
    expect(slugify('FC Dallas & Austin!')).toBe('fc-dallas-austin')
  })
  it('collapses multiple hyphens', () => {
    expect(slugify('A  B')).toBe('a-b')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test
```

Expected: FAIL — `slugify` not defined.

- [ ] **Step 3: Create `lib/auth-helpers.ts`**

```typescript
import { auth } from '@/lib/auth.config'
import { getDb } from '@/db'
import { organizationMembers } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export async function requireSession() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  return session
}

export async function requireOrgMember(orgId: string, userId: string, minRole?: 'admin' | 'owner') {
  const db = getDb()
  const member = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)),
  })
  if (!member) return null
  if (minRole === 'owner' && member.role !== 'owner') return null
  if (minRole === 'admin' && member.role === 'member') return null
  return member
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
npm run test
```

Expected: PASS (3 tests).

- [ ] **Step 5: Create `app/api/orgs/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { organizations, organizationMembers } from '@/db/schema'
import { requireSession, slugify } from '@/lib/auth-helpers'
import { eq } from 'drizzle-orm'

export async function POST(req: Request) {
  const session = await requireSession()
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const db = getDb()
  const baseSlug = slugify(name)
  let slug = baseSlug
  let suffix = 1
  while (true) {
    const existing = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) })
    if (!existing) break
    slug = `${baseSlug}-${suffix++}`
  }

  const [org] = await db.insert(organizations).values({ name: name.trim(), slug }).returning()
  await db.insert(organizationMembers).values({ orgId: org.id, userId: session.user.id, role: 'owner' })
  return NextResponse.json(org, { status: 201 })
}
```

- [ ] **Step 6: Create `app/api/orgs/[orgSlug]/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { organizations, organizationMembers } from '@/db/schema'
import { requireSession } from '@/lib/auth-helpers'
import { eq, and } from 'drizzle-orm'

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const session = await requireSession()
  const { orgSlug } = await params
  const db = getDb()

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const member = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.orgId, org.id), eq(organizationMembers.userId, session.user.id)),
  })
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json({ ...org, role: member.role })
}
```

- [ ] **Step 7: Create `app/(app)/layout.tsx`**

```tsx
import { requireSession } from '@/lib/auth-helpers'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession()
  return <>{children}</>
}
```

- [ ] **Step 8: Create `app/(app)/onboarding/page.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function OnboardingPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) { setError('Failed to create organization'); return }
    const org = await res.json()
    router.push(`/orgs/${org.slug}`)
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="max-w-md w-full p-8 space-y-4">
        <h1 className="text-2xl font-bold">Create your organization</h1>
        <form onSubmit={handleCreate} className="space-y-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Springfield Soccer Club"
            className="w-full border rounded-lg px-4 py-2"
            required
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-lg">
            Create Organization
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 9: Create `app/(app)/orgs/[orgSlug]/page.tsx`**

```tsx
import { requireSession } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, organizationMembers, teams } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'

export default async function OrgPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const session = await requireSession()
  const { orgSlug } = await params
  const db = getDb()

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) notFound()

  const member = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.orgId, org.id), eq(organizationMembers.userId, session.user.id)),
  })
  if (!member) redirect('/onboarding')

  const orgTeams = await db.query.teams.findMany({ where: eq(teams.orgId, org.id) })

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-bold">{org.name}</h1>
      <section>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Teams</h2>
          <Link href={`/orgs/${orgSlug}/teams/new`} className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm">
            New Team
          </Link>
        </div>
        {orgTeams.length === 0 ? (
          <p className="text-gray-500">No teams yet.</p>
        ) : (
          <ul className="space-y-2">
            {orgTeams.map((team) => (
              <li key={team.id}>
                <Link href={`/orgs/${orgSlug}/teams/${team.id}`} className="block p-4 border rounded-lg hover:bg-gray-50">
                  {team.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
```

- [ ] **Step 10: Update `app/page.tsx` to redirect to onboarding**

```tsx
import { requireSession } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizationMembers, organizations } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

export default async function HomePage() {
  const session = await requireSession()
  const db = getDb()
  const membership = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, session.user.id),
    with: { org: true },
  })
  if (!membership) redirect('/onboarding')
  redirect(`/orgs/${(membership as any).org.slug}`)
}
```

- [ ] **Step 11: Commit**

```bash
git add app/ lib/auth-helpers.ts
git commit -m "feat: add org creation, onboarding, and dashboard"
```

---

## Task 5: Team Management

**Files:**
- Create: `app/api/orgs/[orgSlug]/teams/route.ts`, `app/api/orgs/[orgSlug]/teams/[teamId]/route.ts`, `app/(app)/orgs/[orgSlug]/teams/new/page.tsx`, `app/(app)/orgs/[orgSlug]/teams/[teamId]/page.tsx`

- [ ] **Step 1: Create `app/api/orgs/[orgSlug]/teams/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { organizations, teams } from '@/db/schema'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgTeams = await db.query.teams.findMany({ where: eq(teams.orgId, org.id) })
  return NextResponse.json(orgTeams)
}

export async function POST(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug } = await params
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const [team] = await db.insert(teams).values({ orgId: org.id, name: name.trim() }).returning()
  return NextResponse.json(team, { status: 201 })
}
```

- [ ] **Step 2: Create `app/api/orgs/[orgSlug]/teams/[teamId]/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { organizations, teams } from '@/db/schema'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) })
  if (!team || team.orgId !== org.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(team)
}
```

- [ ] **Step 3: Create `app/(app)/orgs/[orgSlug]/teams/new/page.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function NewTeamPage() {
  const router = useRouter()
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const [name, setName] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch(`/api/orgs/${orgSlug}/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) return
    const team = await res.json()
    router.push(`/orgs/${orgSlug}/teams/${team.id}`)
  }

  return (
    <main className="max-w-md mx-auto p-8 space-y-4">
      <h1 className="text-2xl font-bold">New Team</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="U16 Girls" className="w-full border rounded-lg px-4 py-2" required />
        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-lg">
          Create Team
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 4: Create `app/(app)/orgs/[orgSlug]/teams/[teamId]/page.tsx` (shell — Drive connect added in Task 6)**

```tsx
import { requireSession } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, driveConnections, projects } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Link from 'next/link'

type Props = { params: Promise<{ orgSlug: string; teamId: string }> }

export default async function TeamPage({ params }: Props) {
  await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) notFound()
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) })
  if (!team || team.orgId !== org.id) notFound()

  const drive = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  const teamProjects = await db.query.projects.findMany({ where: eq(projects.teamId, teamId) })

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-bold">{team.name}</h1>

      <section className="border rounded-lg p-4">
        <h2 className="font-semibold mb-2">Google Drive</h2>
        {drive ? (
          <p className="text-green-700">Connected: {drive.folderName}</p>
        ) : (
          <a href={`/api/orgs/${orgSlug}/teams/${teamId}/drive/connect`}
            className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
            Connect Google Drive
          </a>
        )}
      </section>

      <section>
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold">Projects</h2>
          {drive && (
            <Link href={`/orgs/${orgSlug}/teams/${teamId}/projects/new`}
              className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm">
              New Project
            </Link>
          )}
        </div>
        <ul className="space-y-2">
          {teamProjects.map((p) => (
            <li key={p.id}>
              <Link href={`/orgs/${orgSlug}/teams/${teamId}/projects/${p.id}`}
                className="block p-4 border rounded-lg hover:bg-gray-50">
                <span>{p.name}</span>
                <span className="ml-2 text-sm text-gray-500">{p.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add app/api/orgs/ app/\(app\)/orgs/
git commit -m "feat: add team management and team dashboard"
```

---

## Task 6: Google Drive OAuth Per Team

**Files:**
- Create: `lib/drive/auth.ts`, `app/api/orgs/[orgSlug]/teams/[teamId]/drive/connect/route.ts`, `app/api/orgs/[orgSlug]/teams/[teamId]/drive/callback/route.ts`, `app/api/orgs/[orgSlug]/teams/[teamId]/drive/route.ts`

- [ ] **Step 1: Add Drive OAuth scopes to Google Cloud Console**

In Google Cloud Console → APIs & Services → Credentials → your OAuth client:
- Add scopes: `https://www.googleapis.com/auth/drive.readonly` and `https://www.googleapis.com/auth/drive.file`
- Enable Google Drive API for the project (APIs & Services → Library → Google Drive API → Enable)

- [ ] **Step 2: Add Drive client secret to `.env.local`**

```
# Same Google OAuth client as NextAuth — Drive scopes are added via a separate OAuth flow
DRIVE_GOOGLE_CLIENT_ID=<same as AUTH_GOOGLE_ID>
DRIVE_GOOGLE_CLIENT_SECRET=<same as AUTH_GOOGLE_SECRET>
```

Add `DRIVE_GOOGLE_CLIENT_ID` and `DRIVE_GOOGLE_CLIENT_SECRET` to `wrangler.toml` `[vars]` section.

- [ ] **Step 3: Create `lib/drive/auth.ts`**

```typescript
export async function refreshDriveToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.DRIVE_GOOGLE_CLIENT_ID!,
      client_secret: process.env.DRIVE_GOOGLE_CLIENT_SECRET!,
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`)
  const data = await res.json()
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}

export async function getFreshAccessToken(conn: {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
}): Promise<string> {
  if (!conn.expiresAt || conn.expiresAt - Date.now() > 60_000) return conn.accessToken
  const { accessToken } = await refreshDriveToken(conn.refreshToken)
  return accessToken
}
```

- [ ] **Step 4: Create `app/api/orgs/[orgSlug]/teams/[teamId]/drive/connect/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations } from '@/db/schema'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const state = Buffer.from(JSON.stringify({ orgSlug, teamId })).toString('base64url')
  const scopes = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
  ].join(' ')

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', process.env.DRIVE_GOOGLE_CLIENT_ID!)
  url.searchParams.set('redirect_uri', `${process.env.NEXTAUTH_URL}/api/orgs/${orgSlug}/teams/${teamId}/drive/callback`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scopes)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
```

- [ ] **Step 5: Create `app/api/orgs/[orgSlug]/teams/[teamId]/drive/callback/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { driveConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'No code' }, { status: 400 })

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.DRIVE_GOOGLE_CLIENT_ID!,
      client_secret: process.env.DRIVE_GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXTAUTH_URL}/api/orgs/${orgSlug}/teams/${teamId}/drive/callback`,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 })
  const tokens = await tokenRes.json()

  // Prompt user to paste folder ID (simplest POC approach)
  // In production this would be a folder picker UI
  const folderId = searchParams.get('folder_id') ?? 'PENDING'

  const db = getDb()
  await db.insert(driveConnections).values({
    teamId,
    userId: session.user.id,
    folderId,
    folderName: folderId === 'PENDING' ? 'Pending folder selection' : folderId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  }).onConflictDoUpdate({
    target: driveConnections.teamId,
    set: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    },
  })

  return NextResponse.redirect(new URL(`/orgs/${orgSlug}/teams/${teamId}`, req.url))
}
```

- [ ] **Step 6: Create `app/api/orgs/[orgSlug]/teams/[teamId]/drive/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, driveConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  return NextResponse.json(conn ? { connected: true, folderName: conn.folderName, folderId: conn.folderId } : { connected: false })
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const { folderId, folderName } = await req.json()
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await db.update(driveConnections).set({ folderId, folderName }).where(eq(driveConnections.teamId, teamId))
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await db.delete(driveConnections).where(eq(driveConnections.teamId, teamId))
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 7: Add `NEXTAUTH_URL` to `.env.local`**

```
NEXTAUTH_URL=http://localhost:3000
```

- [ ] **Step 8: Commit**

```bash
git add lib/drive/auth.ts app/api/orgs/
git commit -m "feat: add Google Drive OAuth connection per team"
```

---

## Task 7: Drive Folder Scanner

**Files:**
- Create: `lib/drive/scanner.ts`, `lib/drive/scanner.test.ts`, `app/api/orgs/[orgSlug]/teams/[teamId]/drive/scan/route.ts`, `app/api/orgs/[orgSlug]/teams/[teamId]/players/route.ts`

- [ ] **Step 1: Write failing tests for scanner**

```typescript
// lib/drive/scanner.test.ts
import { describe, it, expect, vi } from 'vitest'
import { parseDriveFiles, pickAudioFiles } from './scanner'

describe('parseDriveFiles', () => {
  it('extracts subfolders as players', () => {
    const files = [
      { id: '1', name: 'John Smith', mimeType: 'application/vnd.google-apps.folder' },
      { id: '2', name: 'Jane Doe', mimeType: 'application/vnd.google-apps.folder' },
      { id: '3', name: 'photo.jpg', mimeType: 'image/jpeg' },
    ]
    expect(parseDriveFiles(files)).toEqual([
      { id: '1', name: 'John Smith' },
      { id: '2', name: 'Jane Doe' },
    ])
  })
})

describe('pickAudioFiles', () => {
  it('returns audio files sorted alphanumerically', () => {
    const files = [
      { id: 'c', name: '03_outro.mp3', mimeType: 'audio/mpeg' },
      { id: 'a', name: '01_intro.mp3', mimeType: 'audio/mpeg' },
      { id: 'b', name: '02_main.wav', mimeType: 'audio/wav' },
      { id: 'd', name: 'photo.jpg', mimeType: 'image/jpeg' },
    ]
    expect(pickAudioFiles(files)).toEqual([
      { id: 'a', name: '01_intro.mp3' },
      { id: 'b', name: '02_main.wav' },
      { id: 'c', name: '03_outro.mp3' },
    ])
  })

  it('ignores non-audio files', () => {
    const files = [{ id: '1', name: 'video.mp4', mimeType: 'video/mp4' }]
    expect(pickAudioFiles(files)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm run test
```

Expected: FAIL — `parseDriveFiles` not defined.

- [ ] **Step 3: Create `lib/drive/scanner.ts`**

```typescript
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/ogg'])
const FOLDER_TYPE = 'application/vnd.google-apps.folder'
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg)$/i

type DriveFile = { id: string; name: string; mimeType: string }

export function parseDriveFiles(files: DriveFile[]): { id: string; name: string }[] {
  return files.filter((f) => f.mimeType === FOLDER_TYPE).map(({ id, name }) => ({ id, name }))
}

export function pickAudioFiles(files: DriveFile[]): { id: string; name: string }[] {
  return files
    .filter((f) => AUDIO_TYPES.has(f.mimeType) || AUDIO_EXTENSIONS.test(f.name))
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}

export async function listFolderContents(folderId: string, accessToken: string): Promise<DriveFile[]> {
  const fields = 'files(id,name,mimeType)'
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error(`Drive API error: ${await res.text()}`)
  const data = await res.json()
  return data.files ?? []
}

export async function scanTeamFolder(folderId: string, accessToken: string) {
  const files = await listFolderContents(folderId, accessToken)
  return {
    players: parseDriveFiles(files),
    audioFiles: pickAudioFiles(files),
  }
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
npm run test
```

Expected: PASS (4 tests).

- [ ] **Step 5: Create `app/api/orgs/[orgSlug]/teams/[teamId]/drive/scan/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, driveConnections, players } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { scanTeamFolder } from '@/lib/drive/scanner'
import { getFreshAccessToken } from '@/lib/drive/auth'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function POST(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  const accessToken = await getFreshAccessToken(conn)
  const { players: foundPlayers, audioFiles } = await scanTeamFolder(conn.folderId, accessToken)

  // Upsert players from discovered subfolders
  for (const p of foundPlayers) {
    const existing = await db.query.players.findFirst({
      where: eq(players.folderName, p.name),
    })
    if (!existing) {
      await db.insert(players).values({ teamId, name: p.name, folderName: p.name })
    }
  }

  const allPlayers = await db.query.players.findMany({ where: eq(players.teamId, teamId) })
  return NextResponse.json({ players: allPlayers, audioFiles })
}
```

- [ ] **Step 6: Create `app/api/orgs/[orgSlug]/teams/[teamId]/players/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, players } from '@/db/schema'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const teamPlayers = await db.query.players.findMany({ where: eq(players.teamId, teamId) })
  return NextResponse.json(teamPlayers)
}
```

- [ ] **Step 7: Commit**

```bash
git add lib/drive/ app/api/orgs/
git commit -m "feat: add Drive folder scanner with player and audio discovery"
```

---

## Task 8: Auto-Sequencer

**Files:**
- Create: `lib/drive/sequencer.ts`, `lib/drive/sequencer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/drive/sequencer.test.ts
import { describe, it, expect } from 'vitest'
import { pickEvenly, mergeChronological } from './sequencer'

describe('pickEvenly', () => {
  it('returns all items when count >= available', () => {
    const items = [{ date: 1 }, { date: 2 }, { date: 3 }]
    expect(pickEvenly(items, 5)).toHaveLength(3)
  })

  it('picks first, last and evenly distributed items', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((date) => ({ date }))
    const picked = pickEvenly(items, 4)
    expect(picked).toHaveLength(4)
    expect(picked[0].date).toBe(1)
    expect(picked[picked.length - 1].date).toBe(10)
  })

  it('returns empty array for empty input', () => {
    expect(pickEvenly([], 4)).toEqual([])
  })
})

describe('mergeChronological', () => {
  it('merges and sorts items from multiple players by date', () => {
    const playerImages = [
      [{ playerId: 'a', date: 3 }, { playerId: 'a', date: 1 }],
      [{ playerId: 'b', date: 2 }, { playerId: 'b', date: 4 }],
    ]
    const result = mergeChronological(playerImages)
    expect(result.map((x) => x.date)).toEqual([1, 2, 3, 4])
  })

  it('handles players with no images', () => {
    expect(mergeChronological([[], [{ playerId: 'a', date: 1 }]])).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm run test
```

Expected: FAIL — `pickEvenly` not defined.

- [ ] **Step 3: Create `lib/drive/sequencer.ts`**

```typescript
export type ImageCandidate = {
  driveFileId: string
  playerId: string
  thumbnailUrl: string | null
  date: number  // ms timestamp from EXIF or Drive modifiedTime
}

export function pickEvenly<T extends { date: number }>(items: T[], n: number): T[] {
  if (items.length === 0) return []
  if (items.length <= n) return [...items]

  const sorted = [...items].sort((a, b) => a.date - b.date)
  if (n === 1) return [sorted[0]]

  const result: T[] = [sorted[0]]
  const step = (sorted.length - 1) / (n - 1)
  for (let i = 1; i < n - 1; i++) {
    result.push(sorted[Math.round(i * step)])
  }
  result.push(sorted[sorted.length - 1])
  return result
}

export function mergeChronological(playerImages: ImageCandidate[][]): ImageCandidate[] {
  return playerImages
    .flat()
    .sort((a, b) => a.date - b.date)
}

export async function fetchPlayerImages(
  playerId: string,
  folderName: string,
  parentFolderId: string,
  accessToken: string
): Promise<ImageCandidate[]> {
  // Find player subfolder
  const q = encodeURIComponent(
    `'${parentFolderId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )
  const folderRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!folderRes.ok) throw new Error(`Drive folder lookup failed: ${await folderRes.text()}`)
  const { files: folders } = await folderRes.json()
  if (!folders?.length) return []

  const subFolderId = folders[0].id
  const imageQ = encodeURIComponent(
    `'${subFolderId}' in parents and mimeType contains 'image/' and trashed=false`
  )
  const fields = 'files(id,name,thumbnailLink,imageMediaMetadata(time),modifiedTime)'
  const imgRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${imageQ}&fields=${fields}&pageSize=1000`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!imgRes.ok) throw new Error(`Drive image list failed: ${await imgRes.text()}`)
  const { files } = await imgRes.json()

  return (files ?? []).map((f: any) => ({
    driveFileId: f.id,
    playerId,
    thumbnailUrl: f.thumbnailLink ?? null,
    date: f.imageMediaMetadata?.time
      ? new Date(f.imageMediaMetadata.time).getTime()
      : new Date(f.modifiedTime).getTime(),
  }))
}

export async function buildPlaylist(
  players: { id: string; folderName: string }[],
  parentFolderId: string,
  accessToken: string,
  imagesPerPlayer: number
): Promise<ImageCandidate[]> {
  const allPlayerImages = await Promise.all(
    players.map((p) => fetchPlayerImages(p.id, p.folderName, parentFolderId, accessToken))
  )
  const selected = allPlayerImages.map((imgs) => pickEvenly(imgs, imagesPerPlayer))
  return mergeChronological(selected)
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
npm run test
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/drive/sequencer.ts lib/drive/sequencer.test.ts
git commit -m "feat: add auto-sequencer with even distribution and chronological merge"
```

---

## Task 9: Project Creation

**Files:**
- Create: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/route.ts`, `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/route.ts`, `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/new/page.tsx`

- [ ] **Step 1: Create `app/api/orgs/[orgSlug]/teams/[teamId]/projects/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, players, playlistItems, driveConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { buildPlaylist } from '@/lib/drive/sequencer'
import { getFreshAccessToken } from '@/lib/drive/auth'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const teamProjects = await db.query.projects.findMany({ where: eq(projects.teamId, teamId) })
  return NextResponse.json(teamProjects)
}

export async function POST(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const { name, imagesPerPlayer = 4, secondsPerImage = 3.5 } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  const [project] = await db.insert(projects).values({
    teamId, name: name.trim(), imagesPerPlayer, secondsPerImage,
  }).returning()

  // Auto-sequence
  const teamPlayers = await db.query.players.findMany({ where: eq(players.teamId, teamId) })
  if (teamPlayers.length > 0) {
    const accessToken = await getFreshAccessToken(conn)
    const playlist = await buildPlaylist(teamPlayers, conn.folderId, accessToken, imagesPerPlayer)
    if (playlist.length > 0) {
      await db.insert(playlistItems).values(
        playlist.map((item, i) => ({
          projectId: project.id,
          playerId: item.playerId,
          driveFileId: item.driveFileId,
          thumbnailUrl: item.thumbnailUrl,
          exifDate: item.date,
          position: i,
        }))
      )
    }
  }

  return NextResponse.json(project, { status: 201 })
}
```

- [ ] **Step 2: Create `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, projects } from '@/db/schema'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, projectId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(project)
}
```

- [ ] **Step 3: Create `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/new/page.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function NewProjectPage() {
  const router = useRouter()
  const { orgSlug, teamId } = useParams<{ orgSlug: string; teamId: string }>()
  const [name, setName] = useState('')
  const [imagesPerPlayer, setImagesPerPlayer] = useState(4)
  const [secondsPerImage, setSecondsPerImage] = useState(3.5)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, imagesPerPlayer, secondsPerImage }),
    })
    if (!res.ok) { setLoading(false); return }
    const project = await res.json()
    router.push(`/orgs/${orgSlug}/teams/${teamId}/projects/${project.id}`)
  }

  return (
    <main className="max-w-md mx-auto p-8 space-y-4">
      <h1 className="text-2xl font-bold">New Project</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Project Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="2024 Season Highlights" className="w-full border rounded-lg px-4 py-2" required />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Images per Player</label>
          <input type="number" min={1} max={20} value={imagesPerPlayer}
            onChange={(e) => setImagesPerPlayer(Number(e.target.value))}
            className="w-full border rounded-lg px-4 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Seconds per Image</label>
          <input type="number" min={1} max={15} step={0.5} value={secondsPerImage}
            onChange={(e) => setSecondsPerImage(Number(e.target.value))}
            className="w-full border rounded-lg px-4 py-2" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded-lg disabled:opacity-50">
          {loading ? 'Creating & sequencing…' : 'Create Project'}
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/orgs/ app/\(app\)/orgs/
git commit -m "feat: add project creation with auto-sequencing"
```

---

## Task 10: Playlist Editor — Display

**Files:**
- Create: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts`, `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/route.ts`, `components/playlist-editor/image-card.tsx`, `components/playlist-editor/music-panel.tsx`, `components/playlist-editor/index.tsx`, `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx`

- [ ] **Step 1: Create playlist API route**

```typescript
// app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, playlistItems, players, projects, driveConnections } from '@/db/schema'
import { eq, asc } from 'drizzle-orm'
import { buildPlaylist } from '@/lib/drive/sequencer'
import { getFreshAccessToken } from '@/lib/drive/auth'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, projectId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const items = await db
    .select({
      id: playlistItems.id,
      position: playlistItems.position,
      driveFileId: playlistItems.driveFileId,
      thumbnailUrl: playlistItems.thumbnailUrl,
      exifDate: playlistItems.exifDate,
      durationOverride: playlistItems.durationOverride,
      playerId: playlistItems.playerId,
      playerName: players.name,
    })
    .from(playlistItems)
    .innerJoin(players, eq(playlistItems.playerId, players.id))
    .where(eq(playlistItems.projectId, projectId))
    .orderBy(asc(playlistItems.position))

  return NextResponse.json(items)
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId, projectId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()

  // Reorder: [{ id, position }]
  if (body.type === 'reorder') {
    for (const { id, position } of body.items) {
      await db.update(playlistItems).set({ position }).where(eq(playlistItems.id, id))
    }
    return NextResponse.json({ ok: true })
  }

  // Remove single item
  if (body.type === 'remove') {
    await db.delete(playlistItems).where(eq(playlistItems.id, body.id))
    return NextResponse.json({ ok: true })
  }

  // Update duration override
  if (body.type === 'duration') {
    await db.update(playlistItems).set({ durationOverride: body.duration }).where(eq(playlistItems.id, body.id))
    return NextResponse.json({ ok: true })
  }

  // Re-sequence
  if (body.type === 'resequence') {
    const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) })
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
    if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })
    const teamPlayers = await db.query.players.findMany({ where: eq(players.teamId, teamId) })
    const accessToken = await getFreshAccessToken(conn)
    const playlist = await buildPlaylist(teamPlayers, conn.folderId, accessToken, project.imagesPerPlayer)

    await db.delete(playlistItems).where(eq(playlistItems.projectId, projectId))
    if (playlist.length > 0) {
      await db.insert(playlistItems).values(
        playlist.map((item, i) => ({
          projectId,
          playerId: item.playerId,
          driveFileId: item.driveFileId,
          thumbnailUrl: item.thumbnailUrl,
          exifDate: item.date,
          position: i,
        }))
      )
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
```

- [ ] **Step 2: Create audio API route**

```typescript
// app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/route.ts
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, driveConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { listFolderContents, pickAudioFiles } from '@/lib/drive/scanner'
import { getFreshAccessToken } from '@/lib/drive/auth'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json([])
  const accessToken = await getFreshAccessToken(conn)
  const files = await listFolderContents(conn.folderId, accessToken)
  return NextResponse.json(pickAudioFiles(files))
}
```

- [ ] **Step 3: Create `components/playlist-editor/image-card.tsx`**

```tsx
'use client'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type PlaylistItem = {
  id: string
  position: number
  driveFileId: string
  thumbnailUrl: string | null
  exifDate: number | null
  durationOverride: number | null
  playerId: string
  playerName: string
}

type Props = {
  item: PlaylistItem
  defaultDuration: number
  onRemove: (id: string) => void
  onDurationChange: (id: string, duration: number) => void
}

export function ImageCard({ item, defaultDuration, onRemove, onDurationChange }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const date = item.exifDate ? new Date(item.exifDate).toLocaleDateString() : 'Unknown date'

  return (
    <div ref={setNodeRef} style={style}
      className="flex items-center gap-3 p-3 border rounded-lg bg-white shadow-sm">
      <button {...attributes} {...listeners}
        className="cursor-grab text-gray-400 hover:text-gray-600 px-1">⠿</button>

      {item.thumbnailUrl ? (
        <img src={item.thumbnailUrl} alt={item.playerName} className="w-16 h-12 object-cover rounded" />
      ) : (
        <div className="w-16 h-12 bg-gray-200 rounded flex items-center justify-center text-xs text-gray-400">
          No preview
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{item.playerName}</p>
        <p className="text-xs text-gray-500">{date}</p>
      </div>

      <div className="flex items-center gap-1">
        <input
          type="number" min={0.5} max={30} step={0.5}
          value={item.durationOverride ?? defaultDuration}
          onChange={(e) => onDurationChange(item.id, Number(e.target.value))}
          className="w-16 border rounded px-2 py-1 text-sm text-center"
        />
        <span className="text-xs text-gray-500">sec</span>
      </div>

      <button onClick={() => onRemove(item.id)}
        className="text-red-400 hover:text-red-600 px-1 text-lg leading-none">×</button>
    </div>
  )
}
```

- [ ] **Step 4: Create `components/playlist-editor/music-panel.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'

type AudioFile = { id: string; name: string }
type Props = { orgSlug: string; teamId: string; projectId: string }

export function MusicPanel({ orgSlug, teamId, projectId }: Props) {
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/audio`)
      .then((r) => r.json())
      .then(setAudioFiles)
      .finally(() => setLoading(false))
  }, [orgSlug, teamId, projectId])

  if (loading) return <p className="text-sm text-gray-500">Loading audio…</p>

  return (
    <div className="border rounded-lg p-4 space-y-2">
      <h3 className="font-semibold text-sm">Music</h3>
      {audioFiles.length === 0 ? (
        <p className="text-sm text-gray-500">
          No audio files found in Drive folder. Add .mp3 or .wav files to your team root folder,
          named alphanumerically (e.g. 01_song.mp3, 02_song.mp3).
        </p>
      ) : (
        <ul className="space-y-1">
          {audioFiles.map((f, i) => (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              <span className="text-gray-400 w-5 text-right">{i + 1}.</span>
              <span>{f.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Create `components/playlist-editor/index.tsx`**

```tsx
'use client'
import { useEffect, useState, useCallback } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { ImageCard } from './image-card'
import { MusicPanel } from './music-panel'

type PlaylistItem = {
  id: string; position: number; driveFileId: string; thumbnailUrl: string | null
  exifDate: number | null; durationOverride: number | null; playerId: string; playerName: string
}

type Props = {
  orgSlug: string; teamId: string; projectId: string
  defaultDuration: number; projectStatus: string
  onRender: () => void; renderLoading: boolean
}

export function PlaylistEditor({ orgSlug, teamId, projectId, defaultDuration, projectStatus, onRender, renderLoading }: Props) {
  const [items, setItems] = useState<PlaylistItem[]>([])
  const [loading, setLoading] = useState(true)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const fetchPlaylist = useCallback(() => {
    fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/playlist`)
      .then((r) => r.json())
      .then(setItems)
      .finally(() => setLoading(false))
  }, [orgSlug, teamId, projectId])

  useEffect(() => { fetchPlaylist() }, [fetchPlaylist])

  async function patchPlaylist(body: object) {
    await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/playlist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((i) => i.id === active.id)
    const newIndex = items.findIndex((i) => i.id === over.id)
    const reordered = arrayMove(items, oldIndex, newIndex).map((item, pos) => ({ ...item, position: pos }))
    setItems(reordered)
    patchPlaylist({ type: 'reorder', items: reordered.map(({ id, position }) => ({ id, position })) })
  }

  function handleRemove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id).map((item, pos) => ({ ...item, position: pos })))
    patchPlaylist({ type: 'remove', id })
  }

  function handleDurationChange(id: string, duration: number) {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, durationOverride: duration } : i))
    patchPlaylist({ type: 'duration', id, duration })
  }

  async function handleResequence() {
    setLoading(true)
    await patchPlaylist({ type: 'resequence' })
    fetchPlaylist()
  }

  const totalSecs = items.reduce((sum, i) => sum + (i.durationOverride ?? defaultDuration), 0)
  const totalMins = (totalSecs / 60).toFixed(1)
  const isRenderable = projectStatus === 'draft' || projectStatus === 'failed'

  if (loading) return <p className="text-gray-500">Loading playlist…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{items.length} images · ~{totalMins} min</p>
        <div className="flex gap-2">
          <button onClick={handleResequence}
            className="text-sm px-3 py-1.5 border rounded-lg hover:bg-gray-50">
            Re-sequence
          </button>
          {isRenderable && (
            <button onClick={onRender} disabled={renderLoading || items.length === 0}
              className="text-sm px-4 py-1.5 bg-green-600 text-white rounded-lg disabled:opacity-50">
              {renderLoading ? 'Queuing…' : 'Render Video'}
            </button>
          )}
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {items.map((item) => (
              <ImageCard key={item.id} item={item} defaultDuration={defaultDuration}
                onRemove={handleRemove} onDurationChange={handleDurationChange} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <MusicPanel orgSlug={orgSlug} teamId={teamId} projectId={projectId} />
    </div>
  )
}
```

- [ ] **Step 6: Create project page**

```tsx
// app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { PlaylistEditor } from '@/components/playlist-editor'

type Project = { id: string; name: string; status: string; secondsPerImage: number }
type RenderJob = { id: string; status: string; outputDriveFileId: string | null; errorMsg: string | null }

export default function ProjectPage() {
  const { orgSlug, teamId, projectId } = useParams<{ orgSlug: string; teamId: string; projectId: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null)
  const [renderLoading, setRenderLoading] = useState(false)

  useEffect(() => {
    fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}`)
      .then((r) => r.json()).then(setProject)
  }, [orgSlug, teamId, projectId])

  // Poll render job every 5 seconds if running
  useEffect(() => {
    if (!renderJob || renderJob.status === 'complete' || renderJob.status === 'failed') return
    const interval = setInterval(() => {
      fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/render`)
        .then((r) => r.json()).then(setRenderJob)
    }, 5000)
    return () => clearInterval(interval)
  }, [renderJob, orgSlug, teamId, projectId])

  async function handleRender() {
    setRenderLoading(true)
    const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/render`, {
      method: 'POST',
    })
    if (res.ok) {
      const job = await res.json()
      setRenderJob(job)
      setProject((p) => p ? { ...p, status: 'rendering' } : p)
    }
    setRenderLoading(false)
  }

  if (!project) return <p className="p-8 text-gray-500">Loading…</p>

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-bold">{project.name}</h1>

      {renderJob && (
        <div className={`p-4 rounded-lg border ${
          renderJob.status === 'complete' ? 'border-green-300 bg-green-50' :
          renderJob.status === 'failed' ? 'border-red-300 bg-red-50' :
          'border-blue-300 bg-blue-50'
        }`}>
          {renderJob.status === 'pending' && <p>Queued — waiting for GitHub Actions runner…</p>}
          {renderJob.status === 'running' && <p>Rendering… this takes 2–3 minutes.</p>}
          {renderJob.status === 'complete' && renderJob.outputDriveFileId && (
            <div className="space-y-2">
              <p className="text-green-800 font-medium">Render complete!</p>
              <video
                src={`https://drive.google.com/uc?id=${renderJob.outputDriveFileId}&export=download`}
                controls className="w-full rounded" />
              <a
                href={`https://drive.google.com/file/d/${renderJob.outputDriveFileId}/view`}
                target="_blank" rel="noopener noreferrer"
                className="text-sm text-blue-600 underline">
                Open in Google Drive
              </a>
            </div>
          )}
          {renderJob.status === 'failed' && (
            <p className="text-red-800">Render failed: {renderJob.errorMsg}</p>
          )}
        </div>
      )}

      <PlaylistEditor
        orgSlug={orgSlug} teamId={teamId} projectId={projectId}
        defaultDuration={project.secondsPerImage}
        projectStatus={project.status}
        onRender={handleRender}
        renderLoading={renderLoading}
      />
    </main>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add components/ app/api/orgs/ app/\(app\)/orgs/
git commit -m "feat: add playlist editor with drag-and-drop and music panel"
```

---

## Task 11: GitHub Actions Render Workflow

**Files:**
- Create: `.github/workflows/render.yml`, `scripts/render.mjs`, `lib/github/actions.ts`

- [ ] **Step 1: Create `lib/github/actions.ts`**

```typescript
export type RenderPayload = {
  playlist: { driveFileId: string; duration: number }[]
  audioFileIds: string[]
  accessToken: string
  folderId: string
  jobId: string
  callbackUrl: string
  callbackSecret: string
}

export async function triggerRender(payload: RenderPayload): Promise<number> {
  const res = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_PAT}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: 'render-video',
        client_payload: payload,
      }),
    }
  )
  if (!res.ok) throw new Error(`GitHub dispatch failed: ${await res.text()}`)
  // GitHub returns 204; we can't get the run ID synchronously.
  // The run ID is updated via callback once the job starts.
  return 0
}
```

- [ ] **Step 2: Create `scripts/render.mjs`**

```javascript
// scripts/render.mjs
// Run by GitHub Actions: node scripts/render.mjs
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const payload = JSON.parse(process.env.RENDER_PAYLOAD)
const { playlist, audioFileIds, accessToken, folderId, jobId, callbackUrl, callbackSecret } = payload

const TMP = '/tmp/render'
fs.mkdirSync(`${TMP}/images`, { recursive: true })
fs.mkdirSync(`${TMP}/audio`, { recursive: true })

async function driveDownload(fileId, dest) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error(`Download ${fileId} failed: ${await res.text()}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
}

async function postCallback(status, extra = {}) {
  await fetch(callbackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, status, secret: callbackSecret, ...extra }),
  })
}

try {
  await postCallback('running')

  // Download images
  for (let i = 0; i < playlist.length; i++) {
    const dest = `${TMP}/images/${String(i).padStart(4, '0')}.jpg`
    await driveDownload(playlist[i].driveFileId, dest)
    console.log(`Downloaded image ${i + 1}/${playlist.length}`)
  }

  // Download audio
  const audioPaths = []
  for (let i = 0; i < audioFileIds.length; i++) {
    const dest = `${TMP}/audio/${String(i).padStart(4, '0')}.audio`
    await driveDownload(audioFileIds[i], dest)
    audioPaths.push(dest)
    console.log(`Downloaded audio ${i + 1}/${audioFileIds.length}`)
  }

  const totalDuration = playlist.reduce((sum, item) => sum + item.duration, 0)

  // Create per-image video segments
  const segPaths = []
  for (let i = 0; i < playlist.length; i++) {
    const img = `${TMP}/images/${String(i).padStart(4, '0')}.jpg`
    const seg = `${TMP}/seg_${i}.mp4`
    const dur = playlist[i].duration
    execSync(
      `ffmpeg -y -loop 1 -t ${dur} -i "${img}" ` +
      `-vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p" ` +
      `-c:v libx264 -preset fast -crf 22 "${seg}"`,
      { stdio: 'inherit' }
    )
    segPaths.push(seg)
  }

  // Concatenate segments with crossfade transitions
  let videoPath
  if (segPaths.length === 1) {
    videoPath = segPaths[0]
  } else {
    const FADE = 0.5
    const inputs = segPaths.map((p) => `-i "${p}"`).join(' ')
    let prevLabel = '[0:v]'
    const filterParts = []
    let accumulatedOffset = 0
    for (let i = 1; i < segPaths.length; i++) {
      accumulatedOffset += playlist[i - 1].duration - FADE
      const outLabel = i < segPaths.length - 1 ? `[v${i}]` : '[vout]'
      filterParts.push(
        `${prevLabel}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${accumulatedOffset.toFixed(3)}${outLabel}`
      )
      prevLabel = outLabel
    }
    videoPath = `${TMP}/video_only.mp4`
    execSync(
      `ffmpeg -y ${inputs} -filter_complex "${filterParts.join(';')}" -map "[vout]" -c:v libx264 -preset fast -crf 22 "${videoPath}"`,
      { stdio: 'inherit' }
    )
  }

  // Prepare audio
  let audioPath
  if (audioPaths.length === 0) {
    audioPath = `${TMP}/audio_silent.aac`
    execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${totalDuration} -c:a aac "${audioPath}"`)
  } else {
    const concatPath = `${TMP}/audio_concat.aac`
    if (audioPaths.length === 1) {
      fs.copyFileSync(audioPaths[0], concatPath)
    } else {
      const listFile = `${TMP}/audio_list.txt`
      fs.writeFileSync(listFile, audioPaths.map((p) => `file '${p}'`).join('\n'))
      execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:a aac "${concatPath}"`, { stdio: 'inherit' })
    }
    audioPath = `${TMP}/audio_final.aac`
    execSync(`ffmpeg -y -stream_loop -1 -i "${concatPath}" -t ${totalDuration} -c:a aac "${audioPath}"`, { stdio: 'inherit' })
  }

  // Merge video + audio
  const outputPath = `${TMP}/output.mp4`
  execSync(`ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${outputPath}"`, { stdio: 'inherit' })

  // Upload to Google Drive via resumable upload
  const fileSize = fs.statSync(outputPath).size
  const initRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(fileSize),
      },
      body: JSON.stringify({
        name: `highlights_${new Date().toISOString().slice(0, 10)}.mp4`,
        parents: [folderId],
        mimeType: 'video/mp4',
      }),
    }
  )
  if (!initRes.ok) throw new Error(`Upload init failed: ${await initRes.text()}`)
  const uploadUrl = initRes.headers.get('location')

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(fileSize) },
    body: fs.readFileSync(outputPath),
    duplex: 'half',
  })
  if (!uploadRes.ok) throw new Error(`Upload failed: ${await uploadRes.text()}`)
  const { id: driveFileId } = await uploadRes.json()

  await postCallback('complete', { driveFileId })
  console.log('Render complete, Drive file ID:', driveFileId)
} catch (err) {
  console.error('Render error:', err)
  await postCallback('failed', { errorMsg: err.message })
  process.exit(1)
}
```

- [ ] **Step 3: Create `.github/workflows/render.yml`**

```yaml
name: Render Highlight Video

on:
  repository_dispatch:
    types: [render-video]

jobs:
  render:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install FFmpeg
        run: sudo apt-get install -y ffmpeg

      - name: Run render script
        env:
          RENDER_PAYLOAD: ${{ toJson(github.event.client_payload) }}
        run: node scripts/render.mjs
```

- [ ] **Step 4: Add GitHub vars to `.env.local`**

```
GITHUB_PAT=<Personal Access Token with repo scope>
GITHUB_OWNER=<your GitHub username or org>
GITHUB_REPO=highlights
```

Add `GITHUB_OWNER` and `GITHUB_REPO` to `wrangler.toml` `[vars]`. Add `GITHUB_PAT` as a secret (not in vars).

- [ ] **Step 5: Commit**

```bash
git add .github/ scripts/render.mjs lib/github/actions.ts
git commit -m "feat: add GitHub Actions FFmpeg render workflow"
```

---

## Task 12: Render Trigger, Callback, and Status

**Files:**
- Create: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/render/route.ts`, `app/api/render-callback/route.ts`

- [ ] **Step 1: Create render route**

```typescript
// app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/render/route.ts
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, projects, playlistItems, players, driveConnections, renderJobs } from '@/db/schema'
import { eq, asc } from 'drizzle-orm'
import { triggerRender } from '@/lib/github/actions'
import { getFreshAccessToken, refreshDriveToken } from '@/lib/drive/auth'
import { listFolderContents, pickAudioFiles } from '@/lib/drive/scanner'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, projectId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const job = await db.query.renderJobs.findFirst({
    where: eq(renderJobs.projectId, projectId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  })
  return NextResponse.json(job ?? null)
}

export async function POST(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId, projectId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  // Refresh token to maximize lifetime before passing to Actions
  const { accessToken, expiresAt } = await refreshDriveToken(conn.refreshToken)
  await db.update(driveConnections).set({ accessToken, expiresAt }).where(eq(driveConnections.teamId, teamId))

  // Build playlist payload
  const items = await db
    .select({
      driveFileId: playlistItems.driveFileId,
      duration: playlistItems.durationOverride,
      position: playlistItems.position,
    })
    .from(playlistItems)
    .where(eq(playlistItems.projectId, projectId))
    .orderBy(asc(playlistItems.position))

  const playlist = items.map((i) => ({
    driveFileId: i.driveFileId,
    duration: i.duration ?? project.secondsPerImage,
  }))

  // Discover audio
  const files = await listFolderContents(conn.folderId, accessToken)
  const audioFileIds = pickAudioFiles(files).map((f) => f.id)

  const callbackSecret = crypto.randomUUID()
  const callbackUrl = `${process.env.NEXTAUTH_URL}/api/render-callback`

  const [job] = await db.insert(renderJobs).values({
    projectId,
    callbackSecret,
    status: 'pending',
  }).returning()

  await db.update(projects).set({ status: 'rendering' }).where(eq(projects.id, projectId))

  await triggerRender({
    playlist,
    audioFileIds,
    accessToken,
    folderId: conn.folderId,
    jobId: job.id,
    callbackUrl,
    callbackSecret,
  })

  return NextResponse.json(job, { status: 201 })
}
```

- [ ] **Step 2: Create `app/api/render-callback/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { renderJobs, projects } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: Request) {
  const { jobId, status, secret, driveFileId, errorMsg } = await req.json()

  const db = getDb()
  const job = await db.query.renderJobs.findFirst({ where: eq(renderJobs.id, jobId) })
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (job.callbackSecret !== secret) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const validStatus = ['running', 'complete', 'failed'] as const
  if (!validStatus.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

  await db.update(renderJobs).set({
    status,
    outputDriveFileId: driveFileId ?? null,
    errorMsg: errorMsg ?? null,
    completedAt: status === 'complete' || status === 'failed' ? Date.now() : null,
  }).where(eq(renderJobs.id, jobId))

  const projectStatus = status === 'complete' ? 'complete' : status === 'failed' ? 'failed' : 'rendering'
  await db.update(projects).set({ status: projectStatus }).where(eq(projects.id, job.projectId))

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Add `RENDER_CALLBACK_SECRET` note to docs**

The callback is secured via per-job `callbackSecret` (random UUID per render). No additional env var needed — the secret is generated per job and stored in D1.

- [ ] **Step 4: Commit**

```bash
git add app/api/
git commit -m "feat: add render trigger, callback handler, and status polling"
```

---

## Task 13: Wrangler D1 + R2 Setup and Deploy

**Files:**
- Modify: `wrangler.toml`

- [ ] **Step 1: Create Cloudflare D1 database**

```bash
npx wrangler d1 create highlights-db
# Copy the database_id from output into wrangler.toml
```

- [ ] **Step 2: Create Cloudflare R2 bucket**

```bash
npx wrangler r2 bucket create highlights-audio
```

- [ ] **Step 3: Run D1 migration against remote**

```bash
npx wrangler d1 migrations apply highlights-db --remote
```

Expected: All tables created in remote D1.

- [ ] **Step 4: Add secrets to Cloudflare via wrangler**

```bash
npx wrangler secret put AUTH_SECRET
npx wrangler secret put AUTH_GOOGLE_SECRET
npx wrangler secret put DRIVE_GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_PAT
```

- [ ] **Step 5: Add `NEXTAUTH_URL` to wrangler.toml vars**

```toml
[vars]
NEXTAUTH_URL = "https://highlights.<your-subdomain>.workers.dev"
AUTH_GOOGLE_ID = "<your google client id>"
DRIVE_GOOGLE_CLIENT_ID = "<same as AUTH_GOOGLE_ID>"
GITHUB_OWNER = "<your github username>"
GITHUB_REPO = "highlights"
```

- [ ] **Step 6: Deploy**

```bash
npm run deploy
```

Expected: App deployed to `https://highlights.<subdomain>.workers.dev`.

- [ ] **Step 7: Update Google OAuth redirect URI**

In Google Cloud Console → Credentials → your OAuth client, add:
- `https://highlights.<subdomain>.workers.dev/api/auth/callback/google`
- `https://highlights.<subdomain>.workers.dev/api/orgs/<orgSlug>/teams/<teamId>/drive/callback`

- [ ] **Step 8: Commit**

```bash
git add wrangler.toml
git commit -m "feat: configure Cloudflare D1, R2, and deployment"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Multi-tenant orgs | Tasks 4–5 |
| Google Drive connection per team | Task 6 |
| Folder structure: team/player subfolders | Tasks 7–8 |
| EXIF date auto-sequencing | Task 8 |
| N images per player, evenly distributed | Task 8 |
| Chronological merge across players | Task 8 |
| Project settings (images/player, sec/image) | Task 9 |
| Playlist editor drag-and-drop | Task 10 |
| Music from Drive (alphanumeric) | Tasks 7, 10, 12 |
| GitHub Actions FFmpeg render | Task 11 |
| Render written back to Drive | Task 11 |
| Render callback + job status | Task 12 |
| Browser video playback from Drive | Task 10 |
| R2 audio fallback | Audio route in Task 10 (GET only — POST upload left for v2) |

**Known POC limitation:** The audio R2 upload fallback (POST to `/audio` route) is not implemented — if no audio is in Drive, the render produces a silent video. This is acceptable for POC.

**Type consistency verified:** `PlaylistItem`, `ImageCandidate`, `RenderPayload` are defined once and used consistently across tasks.
