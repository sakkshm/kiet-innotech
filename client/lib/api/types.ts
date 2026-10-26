import type { CertificateAvailability, CertificateType, EventPass, Invitation, Me, ProfileInput, Profile, ResultCard, Team, TeamInput } from "../types";

/** An error the API reports to the student, e.g. "This student is already part of another team." */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Everything the student portal asks of the backend. Implemented by the mock and the live client. */
export interface StudentApi {
  getMe(): Promise<Me>;
  saveProfile(input: ProfileInput): Promise<Profile>;

  getMyTeam(): Promise<Team | null>;
  createTeam(input: TeamInput): Promise<Team>;
  updateTeam(teamId: string, input: TeamInput): Promise<Team>;
  deleteTeam(teamId: string): Promise<void>;
  submitTeam(teamId: string): Promise<Team>;
  leaveTeam(teamId: string): Promise<void>;
  removeMember(teamId: string, userId: string): Promise<Team>;

  joinTeam(code: string): Promise<Team>;
  resetJoinCode(teamId: string): Promise<Team>;

  inviteMember(teamId: string, email: string): Promise<Team>;
  cancelInvitation(invitationId: string): Promise<Team>;
  getMyInvitations(): Promise<Invitation[]>;
  respondToInvitation(invitationId: string, accept: boolean): Promise<void>;

  /** The event pass shown at the venue (see lib/pass.ts). */
  getMyPass(): Promise<EventPass>;
  /** The team's results, once announced (awaiting until then). */
  getMyResults(): Promise<{ cards: ResultCard[] }>;
  /** Certificates this student may download now (attendance and publication gates applied). */
  getMyCertificates(): Promise<CertificateAvailability[]>;
  /** Downloads one of the student's own certificates; the server derives the recipient from the session. */
  downloadCertificate(type: CertificateType): Promise<Blob>;
}
