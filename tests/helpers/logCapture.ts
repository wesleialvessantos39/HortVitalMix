export type CapturedLogs = {
  error: string[];
  warn: string[];
  restore: () => void;
};

function serialize(values: unknown[]): string {
  return values
    .map((value) => {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(" ");
}

export function captureLogs(): CapturedLogs {
  const originalError = console.error;
  const originalWarn = console.warn;
  const error: string[] = [];
  const warn: string[] = [];

  console.error = (...values: unknown[]) => {
    error.push(serialize(values));
  };
  console.warn = (...values: unknown[]) => {
    warn.push(serialize(values));
  };

  return {
    error,
    warn,
    restore: () => {
      console.error = originalError;
      console.warn = originalWarn;
    },
  };
}
