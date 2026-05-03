import * as React from "react";
import { format, isValid, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateInputProps {
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
  placeholder?: string;
  fromYear?: number;
  toYear?: number;
  disableFuture?: boolean;
  id?: string;
  className?: string;
}

const FORMAT = "MM/dd/yyyy";

export function DateInput({
  value,
  onChange,
  placeholder = "MM/DD/YYYY",
  fromYear,
  toYear,
  disableFuture,
  id,
  className,
}: DateInputProps) {
  const [text, setText] = React.useState<string>(value ? format(value, FORMAT) : "");
  const [open, setOpen] = React.useState(false);

  // Sync external value -> text
  React.useEffect(() => {
    setText(value ? format(value, FORMAT) : "");
  }, [value]);

  const commit = (raw: string) => {
    const t = raw.trim();
    if (!t) {
      onChange(undefined);
      return;
    }
    // Try a few common formats
    const candidates = [FORMAT, "M/d/yyyy", "MM-dd-yyyy", "yyyy-MM-dd"];
    for (const fmt of candidates) {
      const parsed = parse(t, fmt, new Date());
      if (isValid(parsed)) {
        if (disableFuture && parsed > new Date()) return;
        if (fromYear && parsed.getFullYear() < fromYear) return;
        if (toYear && parsed.getFullYear() > toYear) return;
        onChange(parsed);
        setText(format(parsed, FORMAT));
        return;
      }
    }
  };

  return (
    <div className={cn("flex gap-2", className)}>
      <Input
        id={id}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          }
        }}
        className="flex-1"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="Open calendar">
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => {
              onChange(d);
              setOpen(false);
            }}
            defaultMonth={value ?? (fromYear ? new Date(fromYear, 0) : new Date())}
            disabled={(d) => {
              if (disableFuture && d > new Date()) return true;
              if (fromYear && d.getFullYear() < fromYear) return true;
              if (toYear && d.getFullYear() > toYear) return true;
              return false;
            }}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
