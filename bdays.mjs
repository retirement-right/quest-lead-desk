import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://uoneplysuvmaygbrbswd.supabase.co", process.env.LEADJIG_SERVICE_ROLE_KEY, { auth:{persistSession:false}});
const all = [];
let from = 0;
while (true) {
  const { data, error } = await sb.from("leadjig_leads").select("id,name,email,phone,date_of_birth,raw_payload,client_profile").range(from, from+999);
  if (error) { console.error(error); break; }
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
const now = new Date();
const month = now.getMonth()+1;
const monthName = now.toLocaleString("en-US",{month:"long"});
const rows = [];
const parseM = (s)=>{ if(!s) return null; const m=String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return {y:+m[1],m:+m[2],d:+m[3]}; const d=new Date(s); if(isNaN(d)) return null; return {y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate()};};
for (const l of all) {
  const rp = l.raw_payload||{};
  const cp = l.client_profile||{};
  const fn = [rp.first_name,rp.last_name].filter(Boolean).join(" ")||l.name||"—";
  const dob = l.date_of_birth || rp.date_of_birth || rp.birthdate || cp.birthdate;
  const p = parseM(dob);
  if (p && p.m===month) rows.push({who:`${fn} (primary)`, dob:`${p.m}/${p.d}/${p.y}`, day:p.d, email:l.email, phone:l.phone});
  const sp = parseM(cp.spouse_birthdate);
  if (sp && sp.m===month) rows.push({who:`${cp.spouse_name||"(spouse)"} — spouse of ${fn}`, dob:`${sp.m}/${sp.d}/${sp.y}`, day:sp.d, email:l.email, phone:l.phone});
}
rows.sort((a,b)=>a.day-b.day);
console.log(`Total leads scanned: ${all.length}`);
console.log(`Birthdays in ${monthName} ${now.getFullYear()}: ${rows.length}\n`);
for (const r of rows) console.log(`${r.dob.padEnd(12)} ${r.who}  ${r.email||""}  ${r.phone||""}`);
