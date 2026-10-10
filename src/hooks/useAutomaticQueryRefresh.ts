import { useEffect } from "react";
/** Read-only queries revalidate automatically without replacing an editor draft. */
export function useAutomaticQueryRefresh(refresh:()=>void,enabled=true) {
  useEffect(()=>{
    if(!enabled)return;
    const run=()=>{if(navigator.onLine&&document.visibilityState==="visible")refresh();};
    const timer=window.setInterval(run,30_000);
    window.addEventListener("focus",run);window.addEventListener("online",run);document.addEventListener("visibilitychange",run);
    return()=>{window.clearInterval(timer);window.removeEventListener("focus",run);window.removeEventListener("online",run);document.removeEventListener("visibilitychange",run);};
  },[refresh,enabled]);
}
