import { useSyncExternalStore } from "react";
import {
  checkPwaUpdate,
  getPwaSnapshot,
  subscribePwa,
} from "../lib/pwaManager";

export function usePwa() {
  return {
    ...useSyncExternalStore(subscribePwa, getPwaSnapshot, getPwaSnapshot),
    checkUpdates: checkPwaUpdate,
  };
}
