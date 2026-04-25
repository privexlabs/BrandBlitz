import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";

const mockGoogleAuthEnabled = process.env.E2E_MOCK_GOOGLE_OAUTH === "true";

export const authOptions: NextAuthOptions = {
  providers: [
    ...(mockGoogleAuthEnabled
      ? [
          CredentialsProvider({
            id: "google-mock",
            name: "Google",
            credentials: {
              email: { label: "Email", type: "email" },
              name: { label: "Name", type: "text" },
            },
            async authorize(credentials) {
              const email = credentials?.email?.trim() || "e2e-player@example.com";
              const name = credentials?.name?.trim() || "E2E Player";

              return {
                id: email,
                email,
                name,
                mockIdToken: `e2e:${email}:${name}`,
              } as any;
            },
          }),
        ]
      : []),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      // After Google OAuth, register user in our API and get a JWT
      try {
        const idToken =
          account?.provider === "google-mock"
            ? (user as any).mockIdToken
            : (account as { id_token?: string } | null)?.id_token;
        if (!idToken) return false;

        const response = await fetch(
          `${process.env.NEXTAUTH_API_URL ?? process.env.NEXT_PUBLIC_API_URL}/auth/google/callback`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              idToken,
            }),
          }
        );

        if (!response.ok) return false;

        const data = (await response.json()) as { token: string };
        (user as any).apiToken = data.token;
        return true;
      } catch {
        return false;
      }
    },

    async jwt({ token, user }) {
      if ((user as any)?.apiToken) {
        token.apiToken = (user as any).apiToken;
      }
      return token;
    },

    async session({ session, token }) {
      (session as any).apiToken = token.apiToken;
      return session;
    },
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },

  secret: process.env.NEXTAUTH_SECRET,
};
