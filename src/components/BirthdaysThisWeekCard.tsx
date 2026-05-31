import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Cake, ArrowRight } from "lucide-react";

interface Item { name: string; day: number; month: number; contactId: string; }

const parse = (s: any) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  const d = new Date(s); if (isNaN(d.getTime())) return null;
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};

export function BirthdaysThisWeekCard() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    (async () => {
      const all: any[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("leadjig_leads")
          .select("id,name,date_of_birth,raw_payload,client_profile")
          .range(from, from + 999);
        if (error) break;
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < 1000) break;
        from += 1000;
      }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const end = new Date(today); end.setDate(end.getDate() + 7);
      const year = today.getFullYear();
      const out: Item[] = [];
      for (const l of all) {
        const rp = l.raw_payload || {}; const cp = l.client_profile || {};
        const fn = [rp.first_name, rp.last_name].filter(Boolean).join(" ") || l.name || "—";
        const checks: [string, any][] = [
          [fn, l.date_of_birth || rp.date_of_birth || rp.birthdate || cp.birthdate],
          [cp.spouse_name || "(spouse)", cp.spouse_birthdate],
        ];
        for (const [who, dob] of checks) {
          const p = parse(dob); if (!p) continue;
          let d = new Date(year, p.m - 1, p.d);
          if (d < today) d = new Date(year + 1, p.m - 1, p.d);
          if (d >= today && d <= end) out.push({ name: who, day: p.d, month: p.m, contactId: l.id });
        }
      }
      out.sort((a, b) => {
        const da = new Date(year, a.month - 1, a.day); const db = new Date(year, b.month - 1, b.day);
        if (da < today) da.setFullYear(year + 1); if (db < today) db.setFullYear(year + 1);
        return da.getTime() - db.getTime();
      });
      setItems(out);
    })();
  }, []);

  return (
    <Link to="/birthdays" className="block">
      <Card className="hover:bg-muted/40 transition-colors">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/10 text-primary grid place-items-center">
            <Cake className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Birthdays this week</div>
            <div className="text-xs text-muted-foreground truncate">
              {items.length === 0
                ? "No birthdays in the next 7 days"
                : `${items.length} · ${items.slice(0, 4).map(i => i.name).join(", ")}${items.length > 4 ? "…" : ""}`}
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
