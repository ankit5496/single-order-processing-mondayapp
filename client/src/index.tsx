import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import OrderTracking from "./OrderTracking";
import * as serviceWorker from "./serviceWorker";

const root = createRoot(document.getElementById("root")!);
root.render(
  <BrowserRouter>
    <Routes>
      <Route path="/view" element={<App />} />
      <Route path="/tracking" element={<OrderTracking />} />
      <Route path="/" element={<Navigate to="/view" replace />} />
    </Routes>
  </BrowserRouter>
);

serviceWorker.unregister();
