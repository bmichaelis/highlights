import NextAuth, { type NextAuthConfig } from 'next-auth'
import Google from 'next-auth/providers/google'

export const authConfig: NextAuthConfig = {
  providers: [Google],
  pages: { signIn: '/login' },
  trustHost: true,
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
