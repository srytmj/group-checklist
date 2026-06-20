import { readFileSync } from "fs";
import { resolve } from "path";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sslEnv = process.env.DB_SSL ?? "prefer";
const ssl = sslEnv === "disable" ? false : (sslEnv as "prefer" | "require");
const sql = postgres(process.env.DATABASE_URL, { ssl, max: 1 });

const migrationPath = resolve(import.meta.dir, "../migrations/001_init.sql");
const migration = readFileSync(migrationPath, "utf-8");

try {
  await sql.unsafe(migration);
  console.log("Migration applied successfully.");
} catch (err: any) {
  // Idempotent: ignore "already exists" errors on re-run
  if (err.code === "42P07" || err.message?.includes("already exists")) {
    console.log("Schema already exists, skipping.");
  } else {
    console.error("Migration failed:", err.message);
    process.exit(1);
  }
} finally {
  await sql.end();
}
