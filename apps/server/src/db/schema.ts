import type { Locale, OperationKind, OperationStatus, Role, Step, StepStatus } from "@farmhand/contracts";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// --- better-auth (core + admin plugin), shape per @better-auth/cli generate

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  role: text("role").$type<Role>(),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
  locale: text("locale").$type<Locale>().default("en-US").notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// --- farmhand

export interface IntegrationState {
  status: StepStatus;
  message: string;
  checkedAt: string;
}
export type Integrations = Record<"allowlist" | "printstash" | "fdm" | "mobileraker", IntegrationState>;

export const printers = sqliteTable(
  "printers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull().default(7125),
    source: text("source").$type<"discovery" | "manual" | "adopted">().notNull(),
    approvedAt: text("approved_at"),
    approvedBy: text("approved_by"),
    integrations: text("integrations", { mode: "json" }).$type<Integrations>().notNull(),
    lastSnapshot: text("last_snapshot", { mode: "json" }).$type<Record<string, unknown> | null>(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("printers_host_port").on(t.host, t.port)],
);

export const candidates = sqliteTable(
  "candidates",
  {
    host: text("host").notNull(),
    port: integer("port").notNull(),
    name: text("name"),
    klippyState: text("klippy_state"),
    moonrakerVersion: text("moonraker_version"),
    source: text("source").$type<"mdns" | "neigh" | "manual">().notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    dismissedAt: text("dismissed_at"),
  },
  (t) => [primaryKey({ columns: [t.host, t.port] })],
);

export const operations = sqliteTable(
  "operations",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<OperationKind>().notNull(),
    actorId: text("actor_id"),
    actorIp: text("actor_ip"),
    target: text("target"),
    input: text("input", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<OperationStatus>().notNull(),
    steps: text("steps", { mode: "json" }).$type<Step[]>().notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [index("operations_started_idx").on(t.startedAt)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by"),
});
