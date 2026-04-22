# Navigation Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent header to all authenticated pages with an app home link on the left and a user avatar + sign-out dropdown on the right.

**Architecture:** A server component (`AppHeader`) reads the session and passes user name/image to a client component (`UserMenu`) that handles the dropdown toggle and sign-out action. The layout wraps children with top padding to offset the fixed header.

**Tech Stack:** Next.js 15, NextAuth v5, Tailwind CSS

---

## File Map

```
components/
  app-header.tsx     ← new server component, renders header shell
  user-menu.tsx      ← new client component, avatar + dropdown
app/(app)/
  layout.tsx         ← updated to include <AppHeader> and pt-14
```

---

## Task 1: UserMenu client component

**Files:**
- Create: `components/user-menu.tsx`

- [ ] **Step 1: Create `components/user-menu.tsx`**

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { signOut } from 'next-auth/react'

type Props = {
  name: string | null | undefined
  image: string | null | undefined
}

function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function UserMenu({ name, image }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-8 h-8 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {image ? (
          <img src={image} alt={name ?? 'User'} className="w-full h-full object-cover" />
        ) : (
          initials(name)
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-40 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-50">
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the file exists and has no obvious syntax errors**

```bash
npx tsc --noEmit 2>&1 | grep user-menu || echo "no errors"
```

---

## Task 2: AppHeader server component

**Files:**
- Create: `components/app-header.tsx`

- [ ] **Step 1: Create `components/app-header.tsx`**

```tsx
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { UserMenu } from './user-menu'

export async function AppHeader() {
  const session = await auth()
  return (
    <header className="fixed top-0 inset-x-0 h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 z-40">
      <Link href="/" className="text-gray-900 font-bold text-lg">
        Highlights
      </Link>
      {session?.user && (
        <UserMenu name={session.user.name} image={session.user.image} />
      )}
    </header>
  )
}
```

- [ ] **Step 2: Verify no type errors**

```bash
npx tsc --noEmit 2>&1 | grep app-header || echo "no errors"
```

---

## Task 3: Wire header into layout and deploy

**Files:**
- Modify: `app/(app)/layout.tsx`

- [ ] **Step 1: Update `app/(app)/layout.tsx`**

```tsx
import { requireSession } from '@/lib/auth-helpers'
import { AppHeader } from '@/components/app-header'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession()
  return (
    <>
      <AppHeader />
      <div className="pt-14">{children}</div>
    </>
  )
}
```

- [ ] **Step 2: Build and deploy**

```bash
npm run deploy
```

Expected: Build succeeds, worker deploys. Visit the app and confirm:
- Header appears on all authenticated pages
- "Highlights" link navigates to `/`
- Avatar renders (photo or initials)
- Clicking avatar opens dropdown with "Sign out"
- Clicking outside the dropdown closes it
- Signing out redirects to `/login`

- [ ] **Step 3: Commit**

```bash
git add components/app-header.tsx components/user-menu.tsx app/\(app\)/layout.tsx
git commit -m "feat: add persistent header with logo and user menu"
```
