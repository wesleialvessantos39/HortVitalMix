import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "./app.ts";

export default function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  req.url = (req.url ?? "/").replace(/^\/api(?=\/|\?|$)/, "") || "/";
  return new Promise<void>((resolve, reject) => {
    res.on("finish", resolve);
    res.on("close", resolve);
    res.on("error", reject);
    app(
      req as unknown as Parameters<typeof app>[0],
      res as unknown as Parameters<typeof app>[1],
      (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}
