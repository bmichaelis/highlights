# Navigation Design

**Date:** 2026-04-21
**Scope:** Add a persistent header to all authenticated app pages.

---

## Goal

Users currently have no way to navigate back up the hierarchy (org → team → project) without using the browser back button. Add a minimal header that provides an app home link and user sign-out.

---

## Layout

A full-width header bar fixed to the top of every authenticated page (inside `app/(app)/layout.tsx`). Two zones:

- **Left:** "Highlights" wordmark, links to `/` (which redirects to the user's org dashboard)
- **Right:** User avatar with a dropdown containing a "Sign out" button

No breadcrumbs. No sidebar.

---

## Components

### `components/app-header.tsx` (server component)
- Calls `auth()` to get the session
- Renders the header shell with logo on left and `<UserMenu>` on right
- Passes `user.name` and `user.image` to `<UserMenu>`

### `components/user-menu.tsx` (client component, `'use client'`)
- Receives `name: string` and `image: string | null | undefined` as props
- Renders a circular avatar button:
  - If `image` is present: `<img>` with the Google profile photo
  - Otherwise: initials extracted from `name` (first letter of first and last word), displayed on a gray background
- On click: toggles a small dropdown below the avatar with a "Sign out" button
- Sign out calls NextAuth's `signOut()` action pointing to `/login`
- Dropdown closes on outside click (using a `useEffect` with a document click listener)

### `app/(app)/layout.tsx` (updated)
- Imports and renders `<AppHeader>` above `{children}`
- Wraps content in a `<div>` with `pt-14` (or equivalent) to offset the fixed header height

---

## Styling

- Header height: 56px (`h-14`)
- Background: white with a subtle bottom border (`border-b`)
- Logo: bold text, `text-gray-900`
- Avatar: 32px circle (`w-8 h-8`)
- Dropdown: white card with shadow, `rounded-lg`, positioned `right-0` below avatar
- No Tailwind config changes needed — uses existing utility classes

---

## No breadcrumbs

Breadcrumbs were considered and declined. Each page already has its own `<h1>` that names the current context. The logo link provides a single escape hatch back to the top.

---

## Files Changed

- `components/app-header.tsx` — new
- `components/user-menu.tsx` — new
- `app/(app)/layout.tsx` — add `<AppHeader>`, add top padding
