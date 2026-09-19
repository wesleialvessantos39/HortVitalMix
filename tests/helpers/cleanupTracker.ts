type CleanupFn=()=>Promise<void>;
const trackers:CleanupFn[]=[];

export function trackCleanup(fn:CleanupFn):void{trackers.push(fn);}

export async function runAllCleanups():Promise<void>{
  const errors:Error[]=[];
  while(trackers.length>0){
    const fn=trackers.pop();
    if(!fn)continue;
    try{await fn();}catch(error){errors.push(error as Error);}
  }
  if(errors.length>0){
    console.error(`[CLEANUP] ${errors.length} erros durante limpeza:`);
    for(const error of errors)console.error(` - ${error.message}`);
  }
}

export function resetTrackers():void{trackers.length=0;}
