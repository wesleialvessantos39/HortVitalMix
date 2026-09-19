export function parseArgs(args: string[]) {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) throw new Error("INVALID_ARGUMENT");
    const at = arg.indexOf("=");
    if (at >= 0) result[arg.slice(2, at)] = arg.slice(at + 1);
    else {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error("MISSING_ARGUMENT_VALUE");
      result[arg.slice(2)] = value;
    }
  }
  return result;
}
