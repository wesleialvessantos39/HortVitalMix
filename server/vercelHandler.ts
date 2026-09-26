import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "./app.ts";
import { vercelRequestUrl } from "./vercelRequestUrl.ts";

export default function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  req.url = vercelRequestUrl(req.url);
  return new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    res.on("finish", done);
    res.on("close", done);
    res.on("error", done);
    try {
      app(
        req as unknown as Parameters<typeof app>[0],
        res as unknown as Parameters<typeof app>[1],
        (err?: unknown) => {
          if (err && !res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "INTERNAL_SERVER_ERROR" }));
          }
          done();
        },
      );
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "INTERNAL_SERVER_ERROR" }));
      }
      done();
    }
  });
}
