/**
 * Client for the FastAPI backend (the default, unless NEXT_PUBLIC_API_MODE=mock).
 *
 * Every request sends our session token (from POST /auth/google, see lib/auth/session.ts) as
 * `Authorization: Bearer <token>`. The server enforces the rules in lib/rules.ts. JSON is snake_case on the wire
 * and camelCase here. Errors return `{ "detail": "<message for the student>" }` with a 4xx status.
 * A 401 means the session is over: it is cleared here and the portal sends the student to /login.
 *
 * Endpoints this client expects (all under NEXT_PUBLIC_API_URL):
 *
 *   POST   /auth/google       { credential, app } -> { token, expires_at, email, name }   (no Authorization)
 *
 *   GET    /me                                  -> Me            (profile is null until onboarding; includes registration)
 *   PUT    /me/profile        ProfileInput      -> Profile       (creates or updates)
 *   GET    /me/team                             -> Team | null
 *   GET    /me/invitations                      -> Invitation[]  (pending, addressed to me)
 *   GET    /me/pass                             -> EventPass     (seed for the rotating QR, room and attendance)
 *   GET    /me/results                          -> { cards: ResultCard[] } (awaiting, finalist, winner and amount...)
 *
 *   POST   /teams             TeamInput         -> Team          (caller becomes leader)
 *   PATCH  /teams/{id}        TeamInput         -> Team          (leader, draft only)
 *   DELETE /teams/{id}                          -> 204           (leader, draft only)
 *   POST   /teams/{id}/submit                   -> Team          (leader; locks the team)
 *   POST   /teams/{id}/leave                    -> 204           (member, draft only)
 *   DELETE /teams/{id}/members/{user_id}        -> Team          (leader, draft only)
 *   POST   /teams/{id}/invitations  { email }   -> Team          (leader)
 *   POST   /teams/join       { code }          -> Team          (join with the leader's team code)
 *   POST   /teams/{id}/join-code/reset         -> Team          (leader, draft only; old code stops working)
 *
 *   DELETE /invitations/{id}                    -> Team          (leader cancels)
 *   POST   /invitations/{id}/accept             -> 204           (invitee)
 *   POST   /invitations/{id}/decline            -> 204           (invitee)
 */
import { endSession, getToken } from "../auth/session";
import type { CertificateAvailability, CertificateType, EventPass, Invitation, Me, Profile, ResultCard, Team } from "../types";
import { baseUrl, send, type Json } from "./http";
import { ApiError, type StudentApi } from "./types";

const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function convertKeys(value: Json, convert: (key: string) => string): Json {
  if (Array.isArray(value)) return value.map((item) => convertKeys(item, convert));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [convert(k), convertKeys(v, convert)]));
  }
  return value;
}

async function request<T>(method: string, path: string, body?: object): Promise<T> {
  const token = getToken();
  if (!token) {
    // Expired while the page was open.
    endSession();
    throw new ApiError("Your session has ended. Please sign in again.", 401);
  }

  try {
    const data = await send(method, path, { token, body: body ? convertKeys(body as Json, toSnake) : undefined });
    return (data === undefined ? undefined : convertKeys(data, toCamel)) as T;
  } catch (err) {
    // One place for every call: the session is over, so clear it. PortalProvider sees the change and sends
    // the student to /login?next=<this page>. Forms keep their drafts in sessionStorage until they return.
    if (err instanceof ApiError && err.status === 401) endSession();
    throw err;
  }
}

export const liveApi: StudentApi = {
  getMe: () => request<Me>("GET", "/me"),
  saveProfile: (input) => request<Profile>("PUT", "/me/profile", input),

  getMyTeam: () => request<Team | null>("GET", "/me/team"),
  createTeam: (input) => request<Team>("POST", "/teams", input),
  updateTeam: (teamId, input) => request<Team>("PATCH", `/teams/${teamId}`, input),
  deleteTeam: (teamId) => request<void>("DELETE", `/teams/${teamId}`),
  submitTeam: (teamId) => request<Team>("POST", `/teams/${teamId}/submit`),
  leaveTeam: (teamId) => request<void>("POST", `/teams/${teamId}/leave`),
  removeMember: (teamId, userId) => request<Team>("DELETE", `/teams/${teamId}/members/${userId}`),

  joinTeam: (code) => request<Team>("POST", "/teams/join", { code }),
  resetJoinCode: (teamId) => request<Team>("POST", `/teams/${teamId}/join-code/reset`),

  inviteMember: (teamId, email) => request<Team>("POST", `/teams/${teamId}/invitations`, { email }),
  cancelInvitation: (invitationId) => request<Team>("DELETE", `/invitations/${invitationId}`),
  getMyInvitations: () => request<Invitation[]>("GET", "/me/invitations"),
  respondToInvitation: (invitationId, accept) =>
    request<void>("POST", `/invitations/${invitationId}/${accept ? "accept" : "decline"}`),
  getMyPass: () => request<EventPass>("GET", "/me/pass"),
  getMyResults: () => request<{ cards: ResultCard[] }>("GET", "/me/results"),
  getMyCertificates: async () => (await request<{ certificates: CertificateAvailability[] }>("GET", "/me/certificates")).certificates,
  downloadCertificate: (type: CertificateType) => download(`/me/certificates/${type}.pdf`),
};

async function download(path: string): Promise<Blob> {
  const token = getToken();
  if (!token) {
    endSession();
    throw new ApiError("Your session has ended. Please sign in again.", 401);
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError("Could not reach the server. Check your internet connection and try again.", 0);
  }
  if (response.status === 401) endSession();
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(data?.detail ?? "Something went wrong. Please try again.", response.status);
  }
  return response.blob();
}
