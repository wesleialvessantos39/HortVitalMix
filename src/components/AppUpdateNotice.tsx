import { useEffect } from "react";
import type { ShellSession } from "../hooks/useSession";
import { setPwaSafetyContext } from "../lib/pwaSafety";
export { appUpdateBlockReason } from "../lib/pwaSafety";

export function AppUpdateNotice({
  path,
  session,
  sessionLoading = false,
}: {
  path: string;
  session: ShellSession | null;
  sessionLoading?: boolean;
}) {
  useEffect(() => {
    setPwaSafetyContext(
      path,
      sessionLoading,
      session?.userId,
      session?.activeRole ?? "",
    );
  }, [path, sessionLoading, session?.userId, session?.activeRole]);
  // Keep the safety context active without interrupting navigation. Update
  // progress is visible only in the updates page opened by the user.
  return null;
}
