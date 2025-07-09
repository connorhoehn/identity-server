import 'express-session';

declare module 'express-session' {
  interface SessionData {
    mfaSetup?: {
      accountId: string;
      poolId: string;
      email: string;
      interactionUid: string;
      clientId?: string;
      redirectUri?: string;
      clientState?: string;
      codeChallenge?: string;
      codeChallengeMethod?: string;
      scope?: string;
    };
    mfaVerification?: {
      accountId: string;
      poolId: string;
      email: string;
      interactionUid: string;
    };
  }
}
