# Architecture rules

- Keep inbound phone normalization in `src/lib/phoneMatching.ts` and reuse it from the resolver so its existing matching rules can be tested without authentication, database writes, or message sends.
- Cross-project checkouts are read-only evidence; repairs to another project's application must be made from that project's own chat.
- Keep authoritative marketing policy and website read adapters in `supabase/functions/_shared`; browser preflight reuses the policy, while each email function independently enforces it at the provider boundary to prevent UI bypass.
- Keep `process-followups` read-only until a separately authorized dispatch implementation shares atomic claims with browser dispatch; request parameters must never enable backlog sending.
- Scheduler website reads use the dedicated shared-secret bounded scan contract, never website service-key REST; reject invalid pages and incomplete scans so failures cannot resemble healthy queues.
- Use compare-and-swap on the full follow-up profile for browser claims and rollback so concurrent tabs or contact edits cannot be overwritten.
- Keep website events in a service-only inbox with atomic idempotency and sticky email suppression; check-ins never change contacts, consent, follow-ups, or trigger sends.
- Email provider boundaries must re-read Cloud suppression as well as website pause; unavailable suppression storage blocks marketing rather than ignoring unsubscribe events.