import type { QueryClient } from "@tanstack/react-query";
import {
  createHashHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
  context: {
    queryClient: undefined!,
  },
  history: createHashHistory(),
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function AppRouterProvider({ queryClient }: { queryClient: QueryClient }) {
  return <RouterProvider context={{ queryClient }} router={router} />;
}

export { AppRouterProvider, router };
