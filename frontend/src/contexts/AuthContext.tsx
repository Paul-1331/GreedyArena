import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, ApiError } from "@/lib/api";

interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[]
}

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const { user } = await api.get<{ user: User | null }>("/api/auth/me");
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (email: string, password: string) => {
    const { user } = await api.post<{ user: User }>("/api/auth/login", { email, password });
    setUser(user);
  };

  const register = async (email: string, password: string, displayName: string) => {
    const { user } = await api.post<{ user: User }>("/api/auth/register", {
      email,
      password,
      displayName,
    });
    setUser(user);
  };

  const signOut = async () => {
    await api.post("/api/auth/logout");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};

export { ApiError };