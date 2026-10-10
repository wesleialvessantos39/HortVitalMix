import type { Request } from "express";

/** Routing metadata is not a business filter. All remaining fields stay strict. */
export function businessQuery(req: Request) {
  const query = { ...req.query };
  delete query.path;
  delete query.__hvm_path;
  return query;
}
