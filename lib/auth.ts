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
