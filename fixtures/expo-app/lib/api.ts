const BASE_URL = "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options);
  return res.json();
}

export const api = {
  auth: {
    signup: (data: { email: string; password: string }) =>
      request("/api/v1/auth/signup", { method: "POST", body: JSON.stringify(data) }),
    login: (email: string, password: string) =>
      request("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  },
  items: {
    create: (data: { name: string }) =>
      request("/api/v1/items", { method: "POST", body: JSON.stringify(data) }),
    list: () =>
      request("/api/v1/items"),
    get: (id: string) =>
      request(`/api/v1/items/${id}`),
  },
};
