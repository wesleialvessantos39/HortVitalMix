import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const load = (root) => {
  const files = new Map();
  const walk = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + "/" + entry.name;
      if (entry.isDirectory()) walk(join(directory, entry.name), path);
      else files.set(path, readFileSync(join(directory, entry.name)));
    }
  };
  walk(root); return files;
};
const builds = { a: load(".pwa-test-builds/a"), b: load(".pwa-test-builds/b") };
let selected = "a", corrupt = false;
const type = (path) => path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : path.endsWith(".webmanifest") ? "application/manifest+json" : path.endsWith(".svg") ? "image/svg+xml" : path.endsWith(".png") ? "image/png" : "text/html";
createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1:4174").pathname;
  response.setHeader("Cache-Control", "no-store");
  if (path === "/__pwa_test__/switch" && request.method === "POST") {
    let body = ""; for await (const chunk of request) body += chunk;
    const command = JSON.parse(body || "{}");
    if (!["a", "b"].includes(command.build)) { response.writeHead(400).end(); return; }
    selected = command.build; corrupt = Boolean(command.corrupt);
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ selected })); return;
  }
  if (path.startsWith("/api/")) { response.setHeader("Content-Type", "application/json"); response.writeHead(401).end('{"error":"AUTH_REQUIRED"}'); return; }
  if (path === "/favicon.ico") { response.writeHead(204).end(); return; }
  const resource = builds[selected].has(path) ? path : "/index.html";
  response.setHeader("Content-Type", type(resource));
  response.setHeader("Service-Worker-Allowed", "/");
  if (corrupt && selected === "b" && resource.startsWith("/assets/") && resource.endsWith(".js")) response.end("corrupted candidate");
  else response.end(builds[selected].get(resource));
}).listen(4174, "127.0.0.1", () => console.log("Local PWA verification server: http://127.0.0.1:4174"));
