import pg from "pg";
import { config } from "./env.js";

const { Pool } = pg;

export const pool = config.usePostgres
  ? new Pool({
      host: config.pg.host,
      port: config.pg.port,
      database: config.pg.database,
      user: config.pg.user,
      password: config.pg.password,
      max: 10,
      idleTimeoutMillis: 30_000,
    })
  : null;

export async function query(text, params) {
  if (!pool) {
    throw new Error("postgres_disabled");
  }
  return pool.query(text, params);
}
