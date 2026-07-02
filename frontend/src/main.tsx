import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { AuthProvider } from "./auth";
import { initAnalytics } from "./analytics";
// Side-effect import: registers the `beforeinstallprompt` listener at startup so
// Android's native install prompt is captured even before React mounts.
import "./pwa";

initAnalytics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
