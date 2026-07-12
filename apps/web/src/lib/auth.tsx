import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { AuthMagicLinkResponse, PasskeyRecord, UserAccount } from '@lazuli/shared';
import { LazuliAPI } from './api-client';

type AuthStatus = 'loading' | 'authenticated' | 'guest';

interface AuthContextValue {
  status: AuthStatus;
  user: UserAccount | null;
  supportsPasskeys: boolean;
  refreshSession: () => Promise<void>;
  requestMagicLink: (email: string) => Promise<AuthMagicLinkResponse>;
  verifyMagicLink: (token: string) => Promise<UserAccount>;
  signInWithPasskey: (email?: string) => Promise<UserAccount>;
  registerPasskey: (name?: string) => Promise<PasskeyRecord>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function responseError(error: string | null, fallback: string): Error {
  return new Error(error || fallback);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserAccount | null>(null);
  const supportsPasskeys =
    typeof window !== 'undefined' && window.isSecureContext && browserSupportsWebAuthn();

  const refreshSession = useCallback(async () => {
    const response = await LazuliAPI.getMe();
    if (response.success && response.data) {
      setUser(response.data);
      setStatus('authenticated');
      return;
    }
    setUser(null);
    setStatus('guest');
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const requestMagicLink = useCallback(async (email: string) => {
    const response = await LazuliAPI.requestMagicLink(email);
    if (!response.success || !response.data) {
      throw responseError(response.error, 'Could not send the sign-in link.');
    }
    return response.data;
  }, []);

  const verifyMagicLink = useCallback(async (token: string) => {
    const response = await LazuliAPI.verifyMagicLink(token);
    if (!response.success || !response.data) {
      throw responseError(response.error, 'This sign-in link is invalid or expired.');
    }
    // The API also sets the HttpOnly session cookie. Never persist sessionToken in browser storage.
    setUser(response.data.user);
    setStatus('authenticated');
    return response.data.user;
  }, []);

  const signInWithPasskey = useCallback(
    async (email?: string) => {
      if (!supportsPasskeys) {
        throw new Error('Passkeys are not supported in this browser or connection.');
      }
      const optionsResponse = await LazuliAPI.createPasskeyAuthenticationOptions(email);
      if (!optionsResponse.success || !optionsResponse.data) {
        throw responseError(optionsResponse.error, 'Could not start passkey sign-in.');
      }
      const credential = await startAuthentication({
        optionsJSON: optionsResponse.data
          .options as unknown as PublicKeyCredentialRequestOptionsJSON,
      });
      const verification = await LazuliAPI.verifyPasskeyAuthentication(
        optionsResponse.data.challengeId,
        credential as unknown as Record<string, unknown>
      );
      if (!verification.success || !verification.data) {
        throw responseError(verification.error, 'The passkey could not be verified.');
      }
      setUser(verification.data.user);
      setStatus('authenticated');
      return verification.data.user;
    },
    [supportsPasskeys]
  );

  const registerPasskey = useCallback(
    async (name?: string) => {
      if (!user) throw new Error('Sign in before adding a passkey.');
      if (!supportsPasskeys) {
        throw new Error('Passkeys are not supported in this browser or connection.');
      }
      const optionsResponse = await LazuliAPI.createPasskeyRegistrationOptions();
      if (!optionsResponse.success || !optionsResponse.data) {
        throw responseError(optionsResponse.error, 'Could not start passkey registration.');
      }
      const credential = await startRegistration({
        optionsJSON: optionsResponse.data
          .options as unknown as PublicKeyCredentialCreationOptionsJSON,
      });
      const verification = await LazuliAPI.verifyPasskeyRegistration(
        optionsResponse.data.challengeId,
        credential as unknown as Record<string, unknown>,
        name
      );
      if (!verification.success || !verification.data) {
        throw responseError(verification.error, 'The passkey could not be registered.');
      }
      return verification.data;
    },
    [supportsPasskeys, user]
  );

  const logout = useCallback(async () => {
    const response = await LazuliAPI.logout();
    // Clear local auth state even when an already-expired server session cannot be revoked.
    setUser(null);
    setStatus('guest');
    if (!response.success) {
      throw responseError(response.error, 'Signed out locally, but the server did not confirm it.');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      supportsPasskeys,
      refreshSession,
      requestMagicLink,
      verifyMagicLink,
      signInWithPasskey,
      registerPasskey,
      logout,
    }),
    [
      status,
      user,
      supportsPasskeys,
      refreshSession,
      requestMagicLink,
      verifyMagicLink,
      signInWithPasskey,
      registerPasskey,
      logout,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
