import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MobileUpdateNotice } from "./components/MobileUpdateNotice";
import "./index.css";
import "./accountPrivacy.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <MobileUpdateNotice />
  </React.StrictMode>,
);
