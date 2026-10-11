import { useEffect, useState } from "react";
import { hasUnsavedPwaInput } from "../lib/pwaSafety";
/** Refresh queries after reconciliation; never reset a form being edited. */
export function useOfflineDataRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let pending = false;
    const sync = () => {
      pending = true;
      if (!hasUnsavedPwaInput()) {
        pending = false;
        setRevision((v) => v + 1);
      }
    };
    const resume = () => {
      if (pending) setTimeout(sync, 0);
    };
    window.addEventListener("hvm:data-synchronized", sync);
    window.addEventListener("hvm:documents-synchronized", sync);
    document.addEventListener("hvm:form-saved", resume);
    document.addEventListener("focusout", resume);
    return () => {
      window.removeEventListener("hvm:data-synchronized", sync);
      window.removeEventListener("hvm:documents-synchronized", sync);
      document.removeEventListener("hvm:form-saved", resume);
      document.removeEventListener("focusout", resume);
    };
  }, []);
  return revision;
}
