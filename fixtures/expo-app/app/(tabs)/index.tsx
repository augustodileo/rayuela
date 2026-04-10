import { useRouter } from "expo-router";
import { useAuthStore } from "../../lib/auth";
import { api } from "../../lib/api";
import { useEffect, useState } from "react";

export default function ItemListScreen() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [items, setItems] = useState([]);

  useEffect(() => {
    api.items.list().then(setItems);
  }, []);

  const openItem = (id: string) => {
    router.push(`/item/${id}`);
  };

  return null;
}
