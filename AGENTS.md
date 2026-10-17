# Architecture rules

- Keep inbound phone normalization in `src/lib/phoneMatching.ts` and reuse it from the resolver so its existing matching rules can be tested without authentication, database writes, or message sends.
- Cross-project checkouts are read-only evidence; repairs to another project's application must be made from that project's own chat.
- Keep authoritative marketing policy and website read adapters in `supabase/functions/_shared`; browser preflight reuses the policy, while each email function independently enforces it at the provider boundary to prevent UI bypass.
- Keep `process-followups` read-only until a separately authorized dispatch implementation shares atomic claims with browser dispatch; request parameters must never enable backlog sending.
- Use compare-and-swap on the full follow-up profile for browser claims and rollback so concurrent tabs or contact edits cannot be overwritten.