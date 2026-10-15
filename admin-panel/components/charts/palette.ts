import type { ParticipantType, TeamStatus } from "@/lib/types";

/*
 * Chart colours. Validated for colour-blind separation and contrast on the white chart card (dataviz skill,
 * scripts/validate_palette.js): the team-status set as adjacent stacked segments, the participant-type set
 * all-pairs. Two colours sit under 3:1 contrast on white, so every chart also shows values in its legend and
 * offers a table view.
 */

export type Series<K extends string = string> = { key: K; label: string; color: string };

/** Team status is a state with a meaning, so it uses the status colours (blue for "still a draft"). */
export const statusSeries: Series<TeamStatus>[] = [
  { key: "submitted", label: "Submitted", color: "#0ca30c" },
  { key: "draft", label: "Draft", color: "#2a78d6" },
  { key: "withdrawn", label: "Withdrawn", color: "#ec835a" },
  { key: "disqualified", label: "Disqualified", color: "#d03b3b" },
  // Not submitted before the deadline: out of the event, in a neutral grey (labels and the legend carry the meaning).
  { key: "archived", label: "Archived", color: "#9a9cab" },
];

/** Participant type is identity: categorical slots 1 to 3, and purple (slot 7) for startups: at least 13 apart from the others when colour-blind. */
export const typeColors: Record<ParticipantType, string> = { kiet: "#2a78d6", college: "#eb6834", school: "#1baf7a", startup: "#4a3aa7" };

/** Categorical slots in their validated order, for charts whose series are just different things. */
export const categorical = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

/** One-series charts use the brand orange (the InnoTech'26 logo's); its lighter step is the meter track. */
export const accent = "#e85524";
export const accentTrack = "#ffe3d4";

export const chrome = { grid: "#e7e8ee", axis: "#cbccd4", ink: "#292b38", muted: "#5f6275" };
