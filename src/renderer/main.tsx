import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/electron/renderer";
import App from "@renderer/App";
import "@renderer/index.css";

const sentryEndpoint = process.env.SENTRY_ENDPOINT?.trim();

if (sentryEndpoint) {
  Sentry.init({
    dsn: sentryEndpoint
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
