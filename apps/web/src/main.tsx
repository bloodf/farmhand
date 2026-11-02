import "./i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotFound, RouteError } from "./components/app/RouteError";
import { ApiError } from "./lib/api";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: NotFound,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider attribute="class" storageKey="farmhand.theme" defaultTheme="system" enableSystem>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  );
