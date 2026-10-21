// Retired diagnostic endpoint. It previously returned secret-derived data
// (length, prefix, suffix). It must never read environment credentials.
export function retiredDiagnosticHandler(_req: Request): Response {
  return new Response(JSON.stringify({ error: "gone" }), {
    status: 410,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
