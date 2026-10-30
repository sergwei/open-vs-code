/**
 * What the session list of the webview imports to group and date its rows (issue #20). The helpers
 * moved to `src/shared` so the host's native Sessions tree computes the same groups and times;
 * this file only re-exports them, so the picker and its tests keep their import path.
 */
export { EMPTY_TITLE, sessionLabel } from '../../../src/shared/sessionLabel';
export {
  formatSessionTime,
  groupSessions,
  type GroupLabel,
  type SessionGroup,
} from '../../../src/shared/sessionGroups';
