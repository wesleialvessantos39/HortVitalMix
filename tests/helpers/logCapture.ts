const sensitivePatterns = [
  /postgres(?:ql)?:\/\/[^\s]+/i,
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /service_role/i,
  /eyJ[A-Za-z0-9._-]{20,}/,
  /\b\d{11}\b/,
];

export function hasSensitiveData(lines: string[]): {found:boolean; line?:string} {
  const line=lines.find((candidate)=>sensitivePatterns.some((pattern)=>pattern.test(candidate)));
  return line?{found:true,line}:{found:false};
}

export function captureConsole(){
  const lines:string[]=[];
  const original={log:console.log,error:console.error,warn:console.warn};
  console.log=(...args:unknown[])=>{lines.push(args.map(String).join(' '));};
  console.error=(...args:unknown[])=>{lines.push(args.map(String).join(' '));};
  console.warn=(...args:unknown[])=>{lines.push(args.map(String).join(' '));};
  return {lines,restore(){console.log=original.log;console.error=original.error;console.warn=original.warn;}};
}
