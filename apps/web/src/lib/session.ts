import type { Role } from "@farmhand/contracts";
import { useQuery } from "@tanstack/react-query";
import { q } from "./queries";

/** True when the signed-in user is an admin. The server enforces this anyway; the UI only hides controls. */
export const useIsAdmin = () => useQuery(q.session).data?.user.role === "admin";

const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

/** True when the signed-in user has at least `min`. Hides controls only; the server enforces roles. */
export const useHasRole = (min: Role) => {
  const role = useQuery(q.session).data?.user.role;
  return role ? RANK[role] >= RANK[min] : false;
};
