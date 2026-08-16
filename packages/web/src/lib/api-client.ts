import axios, { type AxiosError } from "axios";

export const apiClient = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

let refreshPromise: Promise<unknown> | null = null;

function postRefresh(): Promise<unknown> {
  const doPost = () => axios.post("/api/v1/auth/refresh", null, { withCredentials: true });
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    return navigator.locks.request("fp:auth-refresh", doPost);
  }
  return doPost();
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as typeof error.config & {
      _retry?: boolean;
    };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        if (!refreshPromise) {
          refreshPromise = postRefresh().finally(() => {
            refreshPromise = null;
          });
        }
        await refreshPromise;
        return apiClient(originalRequest);
      } catch {
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);
