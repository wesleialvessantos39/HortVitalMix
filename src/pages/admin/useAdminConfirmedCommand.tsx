import { useEffect, useRef, useState } from "react";
import { AdminReauthentication } from "../../components/commerce/AdminReauthentication";
import { usePortalSession } from "../../components/notifications/NotificationProvider";
import { readAdminSessionIdentityVersion } from "../../lib/adminSessionStore";
import type { ApiFailure } from "../../lib/api";

type Task = (signal: AbortSignal) => Promise<void>;
type Confirmation = { actorId: string; role: string; task: Task };
const recentAuthCodes = new Set([
  "ADMIN_REAUTHENTICATION_REQUIRED",
  "ADMIN_REAUTH_REQUIRED",
  "REAUTH_REQUIRED",
  "RECENT_AUTH_REQUIRED",
]);

/** Keeps the exact command and actor while password confirmation is pending. */
export function useAdminConfirmedCommand(
  role: string | null,
  onFailure: (failure: unknown) => void,
) {
  const session = usePortalSession();
  const currentActor = useRef({
    userId: session?.userId,
    role: session?.activeRole,
  });
  currentActor.current = { userId: session?.userId, role: session?.activeRole };
  const mounted = useRef(true);
  const flight = useRef(false);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  async function run(task: Task, retry = false, expected?: Confirmation) {
    if (flight.current || (!retry && confirmation)) return;
    const actor = currentActor.current;
    if (
      (role !== "platform_admin" && role !== "platform_super_admin") ||
      !actor.userId ||
      actor.role !== role ||
      (expected &&
        (actor.userId !== expected.actorId || actor.role !== expected.role))
    ) {
      onFailure({ message: "SESSION_CHANGED", status: 401 });
      return;
    }
    const actorId = actor.userId;
    const actorRole = actor.role;
    const identityVersion = readAdminSessionIdentityVersion();
    const controller = new AbortController();
    request.current = controller;
    flight.current = true;
    setBusy(true);
    try {
      await task(
        AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      );
    } catch (failure) {
      if (!mounted.current || controller.signal.aborted) return;
      const unchanged =
        currentActor.current.userId === actorId &&
        currentActor.current.role === actorRole &&
        readAdminSessionIdentityVersion() === identityVersion;
      if (
        !retry &&
        unchanged &&
        recentAuthCodes.has((failure as ApiFailure).message)
      ) {
        setConfirmation({ actorId, role: actorRole!, task });
      } else {
        onFailure(
          unchanged ? failure : { message: "SESSION_CHANGED", status: 401 },
        );
      }
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function confirm() {
    const pending = confirmation;
    if (!pending || !mounted.current) return;
    setConfirmation(null);
    await run(pending.task, true, pending);
  }

  return {
    run,
    busy,
    confirmation,
    confirm,
    cancel: () => setConfirmation(null),
  };
}

export function AdminCommandConfirmation({
  confirmation,
  onConfirmed,
  onCancel,
}: {
  confirmation: Confirmation | null;
  onConfirmed: () => Promise<void>;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    setConfirming(false);
    if (confirmation && element && !element.open) element.showModal();
    if (!confirmation && element?.open) element.close();
  }, [confirmation]);
  return (
    <dialog
      ref={dialog}
      className="hvm-commerce admin-command-confirmation"
      aria-label="Confirmar operação administrativa"
      onCancel={(event) => {
        event.preventDefault();
        if (!confirming) onCancel();
      }}
    >
      {confirmation && (
        <AdminReauthentication
          key={`${confirmation.actorId}:${confirmation.role}`}
          expectedUserId={confirmation.actorId}
          expectedRole={confirmation.role}
          onConfirmed={onConfirmed}
          onCancel={onCancel}
          onBusyChange={setConfirming}
        />
      )}
    </dialog>
  );
}
