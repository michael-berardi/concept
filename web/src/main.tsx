import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider, ToastProvider } from "@/ui/primitives";
import { SessionProvider } from "@/state/session";
import { AppRoutes } from "@/app/AppRoutes";
import "@/styles/themes.css";
import "@/styles/base.css";
import "@/styles/editor.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <SessionProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </SessionProvider>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);
