import "../../components/menu.css";
import "./popup.css";

import React from "react";
import ReactDOM from "react-dom/client";

import { initLang } from "../../lib/lang";
import { App } from "./App";

initLang();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
