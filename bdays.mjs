import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://uoneplysuvmaygbrbswd.supabase.co","sb_publishable_8Vv7urmF3VqUXH3avaxrsg_cfSNKWr1");
const all = [];
let from = 0;
while (true) {
  const { data, error } = await sb.from("leadjig_leads").select("id,name,email,phone,date_of_birth,raw_payload,client_profile").range(from, from+999);
  if (error) { console.error(error); break; }
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
const month = new Date().getMonth()+1;
const monthName = new Date().toLocaleString("en-US",{month:"long"});
const rows = [];
const parseM = (s)=>{ if(!s) return null; const d=new Date(s); if(isNaN(d)) return null; return {m:d.getUTCMonth()+1,d:d.getUTCDate(),y:d.getUTCFullYear()};};
for (const l of all) {
  const rp = l.raw_payload||{};
  const cp = l.client_profile||{};
  const fn = [rp.first_name,rp.last_name].filter(Boolean).join(" ")||l.name||"—";
  const p = parseM(l.date_of_birth);
  if (p && p.m===month) rows.push({who:`${fn} (primary)`, dob:`${p.m}/${p.d}/${p.y}`, day:p.d, email:l.email, phone:l.phone});
  const sp = parseM(cp.spouse_birthdate);
  if (sp && sp.m===month) rows.push({who:`${cp.spouse_name||"(spouse)"} — spouse of ${fn}`, dob:`${sp.m}/${sp.d}/${sp.y}`, day:sp.d, email:l.email, phone:l.phone});
}
rows.sort((a,b)=>a.day-b.day);
console.log(`Total leads scanned: ${all.length}`);
console.log(`Birthdays in ${monthName}: ${rows.length}\n`);
for (const r of rows) console.log(`${r.dob.padEnd(12)} ${r.who}  ${r.email||""}  ${r.phone||""}`);
