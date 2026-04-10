import { useAuthStore } from "../lib/auth";
import { api } from "../lib/api";
import { useRouter } from "expo-router";

export default function AuthScreen() {
  const { login } = useAuthStore();
  const router = useRouter();

  const handleLogin = async () => {
    await login("user@test.com", "password");
    router.replace("/(tabs)");
  };

  return null; // simplified, no JSX needed for analysis
}
