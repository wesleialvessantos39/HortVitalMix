import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./accountPrivacy.css";
import { startPwaManager } from "./lib/pwaManager";
import { startAccountErasureCleanup } from "./lib/accountErasureCleanup";
startAccountErasureCleanup();
startPwaManager();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
