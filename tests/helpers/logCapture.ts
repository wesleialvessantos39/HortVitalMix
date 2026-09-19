export interface CapturedLogs{stdout:string[];stderr:string[];}

export function captureLogs():{
  logs:CapturedLogs;
  restore:()=>void;
  hasSensitiveData:()=>{found:boolean;pattern?:string};
}{
  const logs:CapturedLogs={stdout:[],stderr:[]};
  const originalLog=console.log;
  const originalError=console.error;
  const originalWarn=console.warn;

  console.log=(...args:unknown[])=>logs.stdout.push(args.map(String).join(' '));
  console.error=(...args:unknown[])=>logs.stderr.push(args.map(String).join(' '));
  console.warn=(...args:unknown[])=>logs.stderr.push(args.map(String).join(' '));

  return{
    logs,
    restore:()=>{
      console.log=originalLog;
      console.error=originalError;
      console.warn=originalWarn;
    },
    hasSensitiveData:()=>{
      const sensitive=[
        /postgres(ql)?:\/\/[^\s]+:[^\s]+@/,
        /SUPABASE_SERVICE_ROLE_KEY/,
        /SUPABASE_DB_URL/,
        /Bearer\s+eyJ[A-Za-z0-9\-_\.]+/,
        /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
      ];
      const all=[...logs.stdout,...logs.stderr].join('\n');
      for(const pattern of sensitive){
        if(pattern.test(all))return{found:true,pattern:pattern.toString()};
      }
      return{found:false};
    },
  };
}
