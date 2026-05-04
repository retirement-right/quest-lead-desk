import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  Prospect: "bg-status-prospect text-status-prospect-foreground",
  Client: "bg-status-client text-status-client-foreground",
  "Not Interested": "bg-status-not-interested text-status-not-interested-foreground",
  "Appointment Set": "bg-status-appointment text-status-appointment-foreground",
  Cancelled: "bg-status-cancelled text-status-cancelled-foreground",

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
