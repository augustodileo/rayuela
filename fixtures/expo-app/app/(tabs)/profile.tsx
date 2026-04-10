import { useAuthStore } from "../../lib/auth";

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();
  return null;
}
