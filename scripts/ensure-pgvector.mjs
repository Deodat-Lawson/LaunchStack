import 'dotenv/config';
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[ensure-pgvector] DATABASE_URL is required");
  process.exit(1);
}

console.log("[ensure-pgvector] Connecting to database…");

const sql = postgres(url, { max: 1 });
try {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  const [row] = await sql`
    SELECT installed_version
    FROM pg_available_extensions
    WHERE name = 'vector'
  `;

  if (row?.installed_version) {
    console.log(
      `[ensure-pgvector] pgvector ${row.installed_version} is ready`,
    );
  } else {
    console.error(
      "[ensure-pgvector] Extension 'vector' is not installed in this PostgreSQL server. " +
        "Make sure you are using the pgvector/pgvector Docker image.",
    );
    process.exit(1);
  }
} catch (err) {
  console.error("[ensure-pgvector] Failed to enable pgvector:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
