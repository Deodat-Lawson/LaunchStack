// Skip env validation in tests so that importing ~/env doesn't throw when
// required vars like DATABASE_URL / CLERK_SECRET_KEY aren't set in the test
// environment. Individual tests can still override process.env values.
process.env.SKIP_ENV_VALIDATION = "true";
