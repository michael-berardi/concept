import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider, ToastProvider } from "@/ui/primitives";
import { SessionProvider } from "@/state/session";
import { TabsProvider } from "@/state/tabs";
import { PanelProvider } from "@/state/panel";
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
            <TabsProvider>
              <PanelProvider>
                <AppRoutes />
              </PanelProvider>
            </TabsProvider>
          </BrowserRouter>
        </SessionProvider>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);
