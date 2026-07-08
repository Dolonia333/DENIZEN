import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";

const GlobalTeamChat = lazy(() =>
  import("@/components/GlobalTeamChat").then((m) => ({ default: m.GlobalTeamChat })),
);

const queryClient = new QueryClient();

// Vite base is /crm/ when embedded in Denizen — router must strip that prefix.
const routerBasename = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "/";

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename={routerBasename}>
        <Routes>
          <Route path="/" element={<Index />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      <Suspense fallback={null}>
        <GlobalTeamChat />
      </Suspense>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
