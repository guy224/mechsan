import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getServerSession } from "next-auth";
import argon2 from "argon2";
import { createHash } from "node:crypto";
import { database, one, ensure, AppError, type DB } from "./db";
import { phone } from "./validation";
export type User = {
  id: string;
  name: string;
  phone: string;
  role: "INSTRUCTOR" | "STAFF" | "ADMIN";
  team_id: string;
  disabled: boolean;
  session_version: number;
  password_hash: string;
};
export async function limit(db: DB, key: string, max = 10) {
  const hash = createHash("sha256").update(key).digest("hex");
  const r = await one<{ count: number }>(
    db,
    `INSERT INTO rate_limits(key,count,reset_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<now() THEN 1 ELSE rate_limits.count+1 END,reset_at=CASE WHEN rate_limits.reset_at<now() THEN now()+interval '15 minutes' ELSE rate_limits.reset_at END RETURNING count`,
    [hash],
  );
  ensure(r.count <= max, "יותר מדי ניסיונות. נסו שוב בעוד רבע שעה", 429);
}
const dummy = argon2.hash("dummy-not-a-real-account-password", {
  type: argon2.argon2id,
});
export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  pages: { signIn: "/" },
  providers: [
    Credentials({
      name: "טלפון וסיסמה",
      credentials: { phone: { type: "tel" }, password: { type: "password" } },
      async authorize(credentials) {
        try {
          const p = phone(credentials?.phone ?? "");
          if ((credentials?.password?.length ?? 0) > 128) return null;
          await limit(database(), "login-global", 3000);
          await limit(database(), "login:" + p);
          const u = await one<User>(
            database(),
            "SELECT * FROM users WHERE phone=$1",
            [p],
          );
          const valid = await argon2.verify(
            u?.password_hash ?? (await dummy),
            credentials?.password ?? "",
          );
          if (!u || !valid || u.disabled) return null;
          return { id: u.id, name: u.name, version: u.session_version };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.version = (user as unknown as { version: number }).version;
      }
      return token;
    },
    async session({ session, token }) {
      Object.assign(session.user ?? {}, {
        id: token.sub,
        version: token.version,
      });
      return session;
    },
  },
};
export async function currentUser() {
  const session = await getServerSession(authOptions);
  const s = session?.user as { id?: string; version?: number } | undefined;
  if (!s?.id) throw new AppError("יש להתחבר כדי להמשיך", 401);
  const u = await one<User>(database(), "SELECT * FROM users WHERE id=$1", [
    s.id,
  ]);
  ensure(
    u && !u.disabled && u.session_version === s.version,
    "יש להתחבר מחדש",
    401,
  );
  return u;
}
export function staff(u: User) {
  ensure(u.role === "STAFF" || u.role === "ADMIN", "אין הרשאה לפעולה זו", 403);
}
export function admin(u: User) {
  ensure(u.role === "ADMIN", "נדרשת הרשאת מנהל", 403);
}
