import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { RequireAuth } from "@/components/RequireAuth";
import Login from "./pages/Login";
import Contacts from "./pages/Contacts";
import ContactDetail from "./pages/ContactDetail";
import FollowUps from "./pages/FollowUps";
import Appointments from "./pages/Appointments";
import FailedSyncs from "./pages/FailedSyncs";
import Birthdays from "./pages/Birthdays";
import NotFound from "./pages/NotFound.tsx";


const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<RequireAuth><Contacts /></RequireAuth>} />
            <Route path="/follow-ups" element={<RequireAuth><FollowUps /></RequireAuth>} />
            <Route path="/appointments" element={<RequireAuth><Appointments /></RequireAuth>} />
            <Route path="/contacts/:id" element={<RequireAuth><ContactDetail /></RequireAuth>} />
            <Route path="/failed-syncs" element={<RequireAuth><FailedSyncs /></RequireAuth>} />
            <Route path="/birthdays" element={<RequireAuth><Birthdays /></RequireAuth>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
