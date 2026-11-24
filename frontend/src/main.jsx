import {
  StrictMode
} from "react";
import {
  createRoot
} from "react-dom/client";
import {
  BrowserRouter
} from "react-router-dom";
import {
  App
} from "./App.jsx";
import {
  AuthProvider
} from "./services.jsx";
import {
  ToastProvider
} from "./components.jsx";

// Consolidated VaultLedger frontend. Sections retain their original responsibilities.
import "./index.css";

// ==================== main.jsx ====================
createRoot(document.getElementById('root')).render(<StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>);

