import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = postgres(process.env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  // DB_SSL: "prefer" (Neon default), "require" (AWS RDS), "disable" (local dev without SSL)
  ssl: (process.env.DB_SSL === "disable" ? false : (process.env.DB_SSL ?? "prefer")) as "prefer" | "require" | false,
});

export default sql;
