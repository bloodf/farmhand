import { useQuery } from "@tanstack/react-query";
import { q } from "./queries";

/** True when the signed-in user is an admin. The server enforces this anyway; the UI only hides controls. */
export const useIsAdmin = () => useQuery(q.session).data?.user.role === "admin";
