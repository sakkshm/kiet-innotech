/**
 * The one place the browser talks to the FastAPI backend: adds the timeout and turns every failure into an
 * ApiError with a message for the student. Used by lib/api/live.ts and by sign-in in lib/auth/session.ts.
 */
import { ApiError } from "./types";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export const baseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const TIMEOUT_MS = 20_000;

/** Sends a JSON request and returns the parsed JSON body (undefined for 204). Throws ApiError on any failure. */
export async function send(method: string, path: string, { token, body }: { token?: string; body?: Json } = {}): Promise<Json | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw controller.signal.aborted
        ? new ApiError("The server took too long to respond. Please try again in a moment.", 0)
        : new ApiError("Could not reach the server. Check your internet connection and try again.", 0);
    }

    if (response.status === 204) return undefined;
    const data = (await response.json().catch(() => null)) as Json;
    if (controller.signal.aborted) throw new ApiError("The server took too long to respond. Please try again in a moment.", 0);
    if (!response.ok) {
      const detail = data && typeof data === "object" && !Array.isArray(data) ? data.detail : null;
      throw new ApiError(typeof detail === "string" ? detail : "Something went wrong. Please try again.", response.status);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
