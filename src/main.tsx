import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import "./index.css";
import App from "./App";
import { AppErrorBoundary } from "./components/common/AppErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ThemeProvider
        attribute="data-theme"
        defaultTheme="dark"
        enableSystem={false}
        themes={["dark", "light"]}
      >
        <App />
      </ThemeProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
