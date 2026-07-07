import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./providers/AuthProvider";
import { AppRoutes } from "./routes";
import { Toaster } from "sonner";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <Toaster theme="dark" position="bottom-right" />
      </AuthProvider>
    </BrowserRouter>
  );
}
