import { create } from "zustand";

interface AuthState {
  user: { id: string; email: string } | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  login: async (email: string, password: string) => {
    const res = await api.auth.login(email, password);
    set({ user: res.user, isAuthenticated: true });
  },
  logout: () => set({ user: null, isAuthenticated: false }),
}));
