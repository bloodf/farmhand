/** Browser stand-in for `node:os`, which @farmhand/contracts imports for server-side host checks. */
export const networkInterfaces = (): Record<string, never[]> => ({});
