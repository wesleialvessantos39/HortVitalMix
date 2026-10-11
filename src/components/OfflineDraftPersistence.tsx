import { useEffect } from "react";
import type { ShellSession } from "../hooks/useSession";
import { mountOfflineDrafts } from "../lib/offlineDrafts";
export function OfflineDraftPersistence({
  path,
  session,
}: {
  path: string;
  session: ShellSession | null;
}) {
  useEffect(
    () => mountOfflineDrafts(path),
    [path, session?.userId, session?.activeRole],
  );
  return null;
}
