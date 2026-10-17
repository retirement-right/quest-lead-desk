# Architecture rules

- Keep inbound phone normalization in `src/lib/phoneMatching.ts` and reuse it from the resolver so its existing matching rules can be tested without authentication, database writes, or message sends.
- Cross-project checkouts are read-only evidence; repairs to another project's application must be made from that project's own chat.