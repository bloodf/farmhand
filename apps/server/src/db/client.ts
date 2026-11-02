import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];

const migrationsFolder = new URL("./migrations", import.meta.url).pathname;

export function createDb(path: string) {
  const client = createClient({ url: path === ":memory:" ? ":memory:" : `file:${path}` });
  const db = drizzle(client, { schema });
  return {
    db,
    client,
    async migrate() {
      if (path !== ":memory:") await client.execute("PRAGMA journal_mode = WAL");
      await client.execute("PRAGMA foreign_keys = ON");
      await migrate(db, { migrationsFolder });
    },
  };
}
