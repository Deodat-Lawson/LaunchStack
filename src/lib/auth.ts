import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import {
    authUser,
    authSession,
    authAccount,
    authVerification,
} from "~/server/db/schema/auth";

// Better Auth needs its own lightweight DB client to avoid circular imports
// with the main db (which imports schema, which could re-trigger module init).
const client = postgres(process.env.DATABASE_URL!, { max: 5 });
const authDb = drizzle(client);

export const auth = betterAuth({
    database: drizzleAdapter(authDb, {
        provider: "pg",
        schema: {
            user: authUser,
            session: authSession,
            account: authAccount,
            verification: authVerification,
        },
    }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL,
    emailAndPassword: {
        enabled: true,
    },
    session: {
        expiresIn: 60 * 60 * 24 * 30, // 30 days
        updateAge: 60 * 60 * 24,       // refresh once per day
    },
});
