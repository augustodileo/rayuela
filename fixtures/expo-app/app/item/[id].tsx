import { useLocalSearchParams } from "expo-router";
import { api } from "../../lib/api";
import { useAuthStore } from "../../lib/auth";
import { useEffect, useState } from "react";

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams();
  const { user } = useAuthStore();
  const [item, setItem] = useState(null);

  useEffect(() => {
    api.items.get(id as string).then(setItem);
  }, [id]);

  return null;
}
