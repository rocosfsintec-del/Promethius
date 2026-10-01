import { createContext, useContext, useEffect, useState } from "react";
import api from "../lib/api";

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("promethius_token");
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => localStorage.removeItem("promethius_token"))
      .finally(() => setLoading(false));
  }, []);

  const persist = (data) => {
    localStorage.setItem("promethius_token", data.token);
    setUser(data.user);
  };

  const applySession = (data) => persist(data);

  const login = async (email, password) => {
    const r = await api.post("/auth/login", { email, password });
    persist(r.data);
  };

  const register = async (name, email, password) => {
    const r = await api.post("/auth/register", { name, email, password });
    persist(r.data);
  };

  const logout = () => {
    localStorage.removeItem("promethius_token");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, applySession }}>
      {children}
    </AuthContext.Provider>
  );
};
