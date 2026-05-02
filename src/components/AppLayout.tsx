import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LogOut, Users } from "lucide-react";

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const loc = useLocation();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <div className="h-7 w-7 rounded-md bg-primary text-primary-foreground grid place-items-center text-xs">
              LJ
            </div>
            Leadjig CRM
          </Link>
          <nav className="flex items-center gap-1">
            <Link to="/">
              <Button variant={loc.pathname === "/" ? "secondary" : "ghost"} size="sm">
                <Users className="h-4 w-4" /> Contacts
              </Button>
            </Link>
            <span className="text-xs text-muted-foreground hidden sm:inline ml-3 mr-2">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
}
