import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { q } from "@/lib/queries";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context: { queryClient } }) => {
    const { needsSetup } = await queryClient.ensureQueryData(q.setupStatus);
    if (needsSetup) throw redirect({ to: "/setup" });
    const session = await queryClient.ensureQueryData(q.session);
    if (!session) throw redirect({ to: "/login" });
    return { session };
  },
  component: AppLayout,
});

function AppLayout() {
  const initial = Route.useRouteContext().session;
  const session = useQuery(q.session).data ?? initial;
  return (
    <AppShell user={session.user}>
      <Outlet />
    </AppShell>
  );
}
