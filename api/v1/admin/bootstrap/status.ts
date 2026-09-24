import type { IncomingMessage, ServerResponse } from "node:http";
import vercelHandler from "../../../../server/vercelHandler.ts";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return vercelHandler(req, res);
}
