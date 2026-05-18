import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  "Hot Lead": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30",
  Prospect: "bg-status-prospect text-status-prospect-foreground",
  Client: "bg-status-client text-status-client-foreground",
  "Not Interested": "bg-status-not-interested text-status-not-interested-foreground",
  "Appointment Set": "bg-status-appointment text-status-appointment-foreground",
  Cancelled: "bg-status-cancelled text-status-cancelled-foreground",
};

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const label = status || "Prospect";
  const style = styles[label] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        style,
        className,
      )}
    >
      {label}
    </span>
  );
}
