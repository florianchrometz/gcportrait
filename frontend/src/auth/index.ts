// SPDX-License-Identifier: Apache-2.0
/**
 * Google sign-in for user mode (frontend/README.md, section "Sign-in"). The session's state is in
 * the app store (`useAppState((s) => s.connect)`); the controls and the token come from `useAuth()`; requests
 * to the backend that need the token go through `fetchWithToken`.
 */
export { AuthProvider, type AuthDependencies } from './AuthProvider';
export { NO_AUTH, useAuth, type AuthControls } from './context';
export { fetchWithToken, NotSignedInError } from './fetch';
export { GIS_SCRIPT_URL } from './gis';
export { ModeSelector } from './ModeSelector';
export { OAUTH_SCOPES, REQUIRED_SCOPES } from './session';
export { SIGN_IN_ACTION, SignInCard } from './SignInCard';
export type {
  AccessMode,
  BackendState,
  RenewalState,
  SessionAccount,
  SessionProblem,
  SessionState,
  SessionStatus,
} from './types';
