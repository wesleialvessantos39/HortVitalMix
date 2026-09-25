import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function greetingForHour(hour: number) {
  return hour >= 5 && hour < 12 ? "Bom dia" : hour >= 12 && hour < 18 ? "Boa tarde" : "Boa noite";
}

// The visitor's device supplies the local time; never guess a name from email.
export function AccountGreeting({ fullName }: { fullName?: string }) {
  const [name, setName] = useState("");
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const update = () => setHour(new Date().getHours());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  useEffect(() => {
    if (fullName !== undefined) return;
    const controller = new AbortController();
    api<{ fullName: string }>("/v1/account/profile", { signal: controller.signal })
      .then((profile) => setName(typeof profile.fullName === "string" ? profile.fullName : ""))
      .catch(() => {});
    return () => controller.abort();
  }, [fullName]);
  const displayName = (fullName ?? name).trim();
  return <>{greetingForHour(hour)}{displayName ? `, ${displayName}` : ""}</>;
}
