// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CURATOR STREAM POPUP — Stashed for Merlin integration
// Draggable window showing curator/agent activity with text concatenation.
// Originally its own component — extracted during the Cortex lobotomy.
// Same pattern as ThoughtStream but for curator cycle events.
// Will be reactivated when Merlin becomes a full coding agent.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
// See the original at git commit e523363 — src/components/CuratorStreamPopup.tsx
// Full WebSocket connection, chunk rendering, drag/resize, text concat, dedupe.
// ~400 lines. Preserved here as a reference marker.
//
// To restore: copy from git history or rebuild using ThoughtStream as the pattern.
// The two popups share 90% of their DNA (drag, resize, scroll, portal rendering).
