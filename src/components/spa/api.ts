"use client";

import { toast } from "sonner";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(path, {
    method,
    headers: body && !isForm ? { "Content-Type": "application/json" } : undefined,
    body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
    credentials: "include",
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const message = (data as { error?: string })?.error || `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, "GET"),
  post: <T>(path: string, body?: unknown) => request<T>(path, "POST", body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>(path, "PUT", body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>(path, "PATCH", body ?? {}),
  del: <T>(path: string) => request<T>(path, "DELETE"),
};

export function toastError(e: unknown) {
  const message = e instanceof Error ? e.message : "Something went wrong";
  toast.error(message);
}
