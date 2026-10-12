import type { AppearancePreference, ColorTheme } from "./appearance.ts";

type RemotePreference = { userId: string; theme: ColorTheme | null };
type SyncOptions = {
  userId: string;
  readLocal: () => AppearancePreference | null;
  applyAccount: (theme: ColorTheme) => void;
  load: () => Promise<RemotePreference>;
  save: (theme: ColorTheme) => Promise<RemotePreference>;
  online: () => boolean;
};

/** Device choices always win; server responses never roll back an interaction. */
export class AppearanceSync {
  private active = true;
  private revision = 0;
  private saving = false;
  private pending: ColorTheme | null = null;
  private options: SyncOptions;
  constructor(options: SyncOptions) { this.options = options; }

  async restore() {
    if (!this.active || !this.options.online()) return;
    const revision = this.revision;
    try {
      const remote = await this.options.load();
      if (!this.active || revision !== this.revision || remote.userId !== this.options.userId) return;
      const local = this.options.readLocal();
      if (!local && (remote.theme === "light" || remote.theme === "dark")) this.options.applyAccount(remote.theme);
      else if (local?.source === "manual" && remote.theme !== local.theme) this.changed(local.theme);
      else if (this.pending) void this.flush();
    } catch { /* Offline or unavailable account storage must not change the device. */ }
  }

  changed(theme: ColorTheme) {
    if (!this.active) return;
    this.revision++;
    this.pending = theme;
    void this.flush();
  }

  async flush() {
    if (!this.active || this.saving || !this.options.online()) return;
    this.saving = true;
    try {
      while (this.active && this.pending && this.options.online()) {
        const theme = this.pending;
        this.pending = null;
        try {
          const remote = await this.options.save(theme);
          if (remote.userId !== this.options.userId) return;
        } catch {
          // Keep the newest choice for the next online event or app launch.
          this.pending ??= theme;
          break;
        }
      }
    } finally { this.saving = false; }
  }

  dispose() { this.active = false; this.pending = null; this.revision++; }
}
