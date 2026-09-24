/** Restore the Express path when Vercel dispatches a nested API to api/index. */
export function vercelRequestUrl(raw = "/") {
  const url = new URL(raw, "http://localhost");
  const rewrittenPath = url.searchParams.get("__hvm_path");
  url.searchParams.delete("__hvm_path");
  // Direct function routes already carry the correct path. Only the dispatcher
  // needs the rewrite parameter; it must never override a direct API endpoint.
  const path = ["/api", "/api/", "/api/index"].includes(url.pathname) && rewrittenPath
    ? "/" + rewrittenPath.replace(/^\/+/, "")
    : url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  return path + url.search;
}
