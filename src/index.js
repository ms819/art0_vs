import React from "react";
import { createRoot } from "react-dom/client";        // React 18 形式
import { BrowserRouter } from "react-router-dom";
import App from "./app/App";

const el = document.getElementById("root");
const root = createRoot(el);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);