import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <TooltipProvider>
      <Outlet />
      <Toaster position="top-center" />
    </TooltipProvider>
  ),
});
