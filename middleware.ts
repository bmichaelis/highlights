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
