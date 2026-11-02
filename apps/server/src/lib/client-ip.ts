/** The client address as the reverse proxy reports it. Never X-Forwarded-For: a client can set that itself. */
export const clientIp = (header: (name: string) => string | undefined, trusted: string): string | null =>
  header(trusted)?.split(",")[0]?.trim() || null;
