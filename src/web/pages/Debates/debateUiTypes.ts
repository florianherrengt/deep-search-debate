import type { DebateTournamentSnapshot } from "../../lib/debateJobs.ts"

/** UI aliases derive from the validated network contract so the two cannot drift. */
export type DebateTournament = DebateTournamentSnapshot
export type DebateStage = DebateTournament["stage"]
export type DebateRound = DebateTournament["rounds"][number]
export type DebateMatch = DebateRound["matches"][number]
export type DebateIdea = DebateMatch["firstIdea"]
export type DebateTranscriptMessage = DebateMatch["messages"][number]
export type DebateStanding = DebateTournament["standings"][number]
