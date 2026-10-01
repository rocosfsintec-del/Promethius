import { useEffect } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Auth from "./pages/Auth";
import Orb from "./pages/Orb";
import Workspace from "./pages/Workspace";
import Admin from "./pages/Admin";
import InstallGuide from "./pages/InstallGuide";

const Protected = ({ children, adminOnly }) => {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="h-screen flex items-center justify-center text-zinc-500 font-mono text-sm">
        Igniting Promethius...
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/" replace />;
  return children;
};

const LoginRoute = () => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <Auth />;
};

function App() {
  useEffect(() => {
    document.title = "Promethius";
  }, []);
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/auth" element={<Navigate to="/login" replace />} />
            <Route path="/install" element={<InstallGuide />} />
            <Route
              path="/"
              element={
                <Protected>
                  <Orb />
                </Protected>
              }
            />
            <Route
              path="/chat"
              element={
                <Protected>
                  <Workspace />
                </Protected>
              }
            />
            <Route
              path="/admin"
              element={
                <Protected adminOnly>
                  <Admin />
                </Protected>
              }
            />
          </Routes>
        </BrowserRouter>
        <Toaster theme="dark" position="top-center" richColors />
      </AuthProvider>
    </div>
  );
}

export default App;
