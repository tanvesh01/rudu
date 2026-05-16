import type { QueryClient } from "@tanstack/react-query";
import { AppRouterProvider } from "./router";

function App({ queryClient }: { queryClient: QueryClient }) {
  return <AppRouterProvider queryClient={queryClient} />;
}

export default App;
