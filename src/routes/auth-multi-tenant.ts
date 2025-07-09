import { Router, Request, Response } from 'express';
import { Provider } from 'oidc-provider';
import { Account } from '../models/account-multi-tenant.js';
import { getDataProvider } from '../providers/data-provider-factory.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Interaction endpoints
router.get('/:uid', async (req: Request, res: Response) => {
  try {
    const provider = req.app.locals.provider as Provider;
    const { uid } = req.params;
    
    logger.info(`[GET] Processing interaction for UID: ${uid}`, {
      url: req.url,
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
      path: req.path,
      method: req.method,
      cookies: req.headers.cookie,
      headers: req.headers,
      query: req.query
    });
    
    logger.info(`[GET] Getting interaction details for UID: ${uid}`);
    const details = await provider.interactionDetails(req, res);
    
    const { prompt, params } = details;
    
    logger.info(`[GET] Interaction details retrieved:`, {
      uid: details.uid,
      prompt: prompt.name,
      promptReasons: prompt.reasons,
      promptDetails: prompt.details,
      client_id: params.client_id,
      session_exists: !!details.session,
      session: details.session,
      grantId: details.grantId,
      lastSubmission: details.lastSubmission,
      params: params
    });
    
    if (prompt.name === 'login') {
      logger.info(`[GET] Rendering login page for UID: ${uid}`);
      return res.render('login', {
        uid,
        details: prompt.details,
        params,
        title: 'Sign In',
        csrfToken: '',
      });
    }
    
    if (prompt.name === 'consent') {
      logger.info(`[GET] Rendering consent page for UID: ${uid}`);
      logger.info('[GET] Consent prompt details:', prompt.details);
      logger.info('[GET] Request cookies:', req.headers.cookie);
      
      return res.render('consent', {
        uid,
        details: prompt.details,
        params,
        title: 'Authorize Application',
        csrfToken: '',
      });
    }
    
    logger.error(`[GET] Unknown prompt: ${prompt.name} for UID: ${uid}`);
    return res.status(501).render('error', {
      title: 'Error',
      message: `Unknown prompt: ${prompt.name}`,
    });
  } catch (error) {
    logger.error('[GET] Interaction error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      uid: req.params.uid,
      route: req.path,
      method: req.method,
      url: req.url,
      originalUrl: req.originalUrl,
      cookies: req.headers.cookie
    });
    return res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred during the authentication process',
    });
  }
});

// Debug endpoint
router.get('/:uid/debug', async (req: Request, res: Response) => {
  try {
    const provider = req.app.locals.provider as Provider;
    const details = await provider.interactionDetails(req, res);
    
    const debugInfo = {
      uid: details.uid,
      prompt: details.prompt,
      params: details.params,
      session: details.session,
      grantId: details.grantId,
      cookies: req.headers.cookie,
      headers: req.headers,
    };
    
    logger.info('Debug info for interaction:', debugInfo);
    
    res.json(debugInfo);
  } catch (error) {
    logger.error('Debug interaction error:', error);
    res.status(500).json({ error: 'Failed to get interaction details' });
  }
});

router.post('/:uid/login', async (req: Request, res: Response) => {
  try {
    const provider = req.app.locals.provider as Provider;
    const { uid } = req.params;
    const { email, password } = req.body;
    
    logger.info(`[LOGIN] POST received for UID: ${uid}`, {
      email,
      hasPassword: !!password,
      body: req.body,
      cookies: req.headers.cookie,
      headers: req.headers,
      url: req.url,
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
      path: req.path
    });
    
    // Get client ID from interaction details to determine the user pool
    logger.info(`[LOGIN] Getting interaction details for UID: ${uid}`);
    const details = await provider.interactionDetails(req, res);
    const clientId = details.params.client_id as string;
    
    logger.info('[LOGIN] Interaction details retrieved:', {
      uid: details.uid,
      clientId,
      prompt: details.prompt,
      params: details.params,
      session: details.session,
      grantId: details.grantId,
      lastSubmission: details.lastSubmission
    });
    
    if (!clientId) {
      logger.error('[LOGIN] No client ID found in interaction details');
      return res.render('login', {
        uid,
        error: 'Invalid client configuration',
        title: 'Sign In',
        csrfToken: '',
      });
    }
    
    logger.info(`[LOGIN] Attempting to authenticate user: ${email} for client: ${clientId}`);
    const account = await Account.authenticate(email, password, clientId);
    
    if (!account) {
      logger.warn(`[LOGIN] Authentication failed for user: ${email}`);
      return res.render('login', {
        uid,
        error: 'Invalid email or password',
        title: 'Sign In',
        csrfToken: '',
      });
    }
    
    logger.info(`[LOGIN] Authentication successful for user: ${email}, accountId: ${account.accountId}`);
    
    // Check if MFA is required for this user
    const dataProvider = getDataProvider();
    const userData = await dataProvider.getUser(account.poolId, String(account.accountId));
    
    if (userData?.mfaEnabled) {
      logger.info(`[LOGIN] MFA required for user: ${email}, redirecting to MFA verification`);
      
      // Store user info in session for MFA verification
      req.session.mfaVerification = {
        accountId: String(account.accountId),
        poolId: account.poolId,
        email: account.profile.email,
        interactionUid: uid
      };
      
      // Redirect to MFA verification page
      return res.render('mfa-verify', {
        uid,
        title: 'Two-Factor Authentication',
        error: null
      });
    }
    
    // Ensure accountId is a string for OIDC provider compatibility
    const accountIdString = String(account.accountId);
    
    // DEBUGGING: Let's manually test findAccount to see if it works
    logger.info('[LOGIN] Testing findAccount manually before interactionFinished...');
    try {
      const mockCtx = {
        oidc: {
          client: { clientId },
        }
      };
      const foundAccount = await Account.findAccount(mockCtx, accountIdString);
      logger.info('[LOGIN] Manual findAccount test result:', {
        accountIdString,
        foundAccount: !!foundAccount,
        foundAccountId: foundAccount?.accountId,
        foundAccountEmail: foundAccount?.profile?.email
      });
    } catch (findAccountError) {
      logger.error('[LOGIN] Manual findAccount test failed:', {
        error: findAccountError instanceof Error ? findAccountError.message : String(findAccountError),
        stack: findAccountError instanceof Error ? findAccountError.stack : undefined
      });
    }
    
    const result = {
      login: {
        accountId: accountIdString,
      },
    };
    
    logger.info('[LOGIN] About to call interactionFinished with result:', {
      result,
      accountId: account.accountId,
      accountIdString,
      accountIdType: typeof account.accountId,
      stringifiedType: typeof accountIdString,
      uid,
      requestPath: req.path,
      requestMethod: req.method,
      cookies: req.headers.cookie,
      userAgent: req.headers['user-agent'],
      interactionDetails: {
        uid: details.uid,
        prompt: details.prompt,
        params: details.params,
        session: details.session,
        grantId: details.grantId
      }
    });
    
    // Check response state before calling interactionFinished
    logger.info('[LOGIN] Response state before interactionFinished:', {
      headersSent: res.headersSent,
      finished: res.finished,
      statusCode: res.statusCode,
      locals: res.locals
    });
    
    // Let's try a different approach - check if we need consent first
    logger.info('[LOGIN] Checking if consent is required for this interaction');
    
    try {
      // Try calling interactionFinished with a different approach
      logger.info('[LOGIN] Calling interactionFinished...');
      const finishResult = await provider.interactionFinished(req, res, result, { 
        mergeWithLastSubmission: false 
      });
      
      logger.info('[LOGIN] InteractionFinished returned:', {
        finishResult,
        headersSent: res.headersSent,
        finished: res.finished,
        statusCode: res.statusCode,
        location: res.get('Location'),
        contentType: res.get('Content-Type'),
        setCookie: res.get('Set-Cookie')
      });
      
      // Check if the response was handled
      if (res.headersSent) {
        logger.info('[LOGIN] Response handled by interactionFinished');
        return;
      } else {
        logger.error('[LOGIN] Response not handled by interactionFinished - this indicates a problem');
      }
      
    } catch (interactionError) {
      logger.error('[LOGIN] Error in interactionFinished:', {
        error: interactionError instanceof Error ? interactionError.message : String(interactionError),
        stack: interactionError instanceof Error ? interactionError.stack : undefined,
        name: interactionError instanceof Error ? interactionError.name : undefined
      });
      
      // If interactionFinished fails, render error
      return res.status(500).render('error', {
        title: 'Authentication Error',
        message: 'Failed to complete authentication process',
      });
    }
    
    // If interactionFinished didn't handle the response, we need to return
    if (!res.headersSent) {
      logger.warn('[LOGIN] Response headers not sent after interactionFinished - this might indicate an issue');
      logger.info('[LOGIN] Current response state:', {
        headersSent: res.headersSent,
        finished: res.finished,
        statusCode: res.statusCode,
        writable: res.writable
      });
      
      // If headers weren't sent, something went wrong
      return res.status(500).render('error', {
        title: 'Authentication Error',
        message: 'Authentication completed but flow did not continue properly',
      });
    }
    
    logger.info('[LOGIN] Login flow completed successfully');
    return; // Important: return after interactionFinished to prevent further execution
    
  } catch (error) {
    logger.error('Login error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      uid: req.params.uid
    });
    return res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred during login',
    });
  }
});

router.post('/:uid/confirm', async (req: Request, res: Response) => {
  try {
    const provider = req.app.locals.provider as Provider;
    const { uid } = req.params;
    
    logger.info(`Processing consent confirmation for interaction UID: ${uid}`);
    logger.info('Request details:', {
      method: req.method,
      path: req.path,
      headers: {
        cookie: req.headers.cookie,
        'content-type': req.headers['content-type'],
      },
      body: req.body,
    });
    
    // Get interaction details first
    const details = await provider.interactionDetails(req, res);
    logger.info('Interaction details:', {
      uid: details.uid,
      prompt: details.prompt,
      params: details.params,
      session: details.session,
      grantId: details.grantId,
    });
    
    // Extract account ID from session
    const accountId = details.session?.accountId;
    if (!accountId) {
      logger.error('No account ID found in session');
      return res.status(400).render('error', {
        title: 'Session Error',
        message: 'No authenticated user found. Please login first.',
      });
    }
    
    logger.info(`Found account ID in session: ${accountId}`, {
      accountId,
      accountIdType: typeof accountId,
      sessionDetails: details.session
    });
    
    // Handle grant creation/update
    let { grantId } = details;
    let grant;
    
    if (grantId) {
      // Try to find existing grant
      logger.info(`Looking for existing grant with ID: ${grantId}`);
      grant = await provider.Grant.find(grantId);
      if (!grant) {
        logger.error(`Grant not found for ID: ${grantId}`);
        return res.status(400).render('error', {
          title: 'Grant Error',
          message: 'Invalid grant. Please try again.',
        });
      }
      logger.info(`Found existing grant: ${grantId}`);
    } else {
      // Create new grant
      logger.info(`Creating new grant for account: ${accountId}, client: ${details.params.client_id}`, {
        accountId,
        accountIdType: typeof accountId,
        clientId: details.params.client_id
      });
      grant = new provider.Grant({
        accountId: accountId, // Use accountId directly as it comes from session
        clientId: details.params.client_id as string,
      });
    }
    
    // Add scopes and claims as needed
    if (details.prompt.details.missingOIDCScope) {
      grant.addOIDCScope(details.prompt.details.missingOIDCScope.join(' '));
      logger.info(`Added OIDC scopes: ${details.prompt.details.missingOIDCScope.join(' ')}`);
    }
    
    if (details.prompt.details.missingOIDCClaims) {
      grant.addOIDCClaims(details.prompt.details.missingOIDCClaims);
      logger.info(`Added OIDC claims: ${JSON.stringify(details.prompt.details.missingOIDCClaims)}`);
    }
    
    if (details.prompt.details.missingResourceScopes) {
      for (const [indicator, scopes] of Object.entries(details.prompt.details.missingResourceScopes)) {
        grant.addResourceScope(indicator, (scopes as string[]).join(' '));
        logger.info(`Added resource scopes for ${indicator}: ${(scopes as string[]).join(' ')}`);
      }
    }
    
    // Save the grant
    grantId = await grant.save();
    logger.info(`Grant saved with ID: ${grantId}`, {
      grantId,
      accountId: grant.accountId,
      clientId: grant.clientId,
      sessionAccountId: details.session?.accountId,
      accountIdMatch: grant.accountId === details.session?.accountId
    });
    
    // Prepare the result
    const consent: any = {};
    if (!details.grantId) {
      // Only set grantId if there wasn't one originally
      consent.grantId = grantId;
    }
    
    const result = { consent };
    
    logger.info('Finishing interaction with result:', result);
    
    await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
    logger.info('Consent interaction finished successfully');
    return; // Important: return after interactionFinished to prevent further execution
    
  } catch (error) {
    logger.error('Consent confirmation error:', error);
    return res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred during consent confirmation',
    });
  }
});

router.get('/:uid/abort', async (req: Request, res: Response) => {
  try {
    const provider = req.app.locals.provider as Provider;
    const result = {
      error: 'access_denied',
      error_description: 'The resource owner denied the request',
    };
    
    await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
    return; // Important: return after interactionFinished to prevent further execution
    
  } catch (error) {
    logger.error('Interaction abort error:', error);
    return res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred while aborting the request',
    });
  }
});

// User registration endpoint (pool-aware)
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, given_name, family_name, nickname, client_id } = req.body;
    
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    
    if (!client_id) {
      res.status(400).json({ error: 'Client ID is required' });
      return;
    }
    
    // Get the user pool for this client
    const dataProvider = getDataProvider();
    const userPool = await dataProvider.getUserPoolByClientId(client_id);
    
    if (!userPool) {
      res.status(400).json({ error: 'Invalid client ID' });
      return;
    }
    
    // Check if user already exists in this pool
    const existingUser = await dataProvider.getUserByEmail(userPool.poolId, email);
    if (existingUser) {
      res.status(409).json({ error: 'User already exists' });
      return;
    }
    
    // Create the user
    const account = await Account.create({
      email,
      password,
      given_name,
      family_name,
      nickname,
    }, userPool.poolId);
    
    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: account.accountId,
        email: account.profile.email,
        name: account.profile.name,
      },
    });
  } catch (error) {
    logger.error('Registration error:', error);
    if (error instanceof Error && error.message.includes('already exists')) {
      res.status(409).json({ error: 'User already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Debug endpoint to create test user
router.post('/debug/create-user', async (req: Request, res: Response) => {
  try {
    const { email = 'admin@localhost', password = 'admin123', poolId = 'default-pool' } = req.body;
    
    logger.info('Creating test user', { email, poolId });
    
    const account = await Account.create({
      email,
      password,
      given_name: 'Admin',
      family_name: 'User',
      nickname: 'admin'
    }, poolId);
    
    res.json({
      success: true,
      message: 'Test user created',
      accountId: account.accountId,
      email: account.profile.email
    });
  } catch (error) {
    logger.error('Error creating test user:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Remove the catch-all route that was interfering with OIDC provider flow
// The OIDC provider needs to handle its own internal redirects after interactionFinished()

// Registration handler for interaction flow
router.post('/:uid/register', async (req: Request, res: Response) => {
  try {
    const provider = req.app.locals.provider as Provider;
    const { uid } = req.params;
    const { email, password, confirm_password, given_name, family_name, enable_mfa } = req.body;
    
    logger.info(`[REGISTER] POST received for UID: ${uid}`, {
      email,
      hasPassword: !!password,
      given_name,
      family_name,
      enable_mfa: !!enable_mfa
    });
    
    // Validate password confirmation
    if (password !== confirm_password) {
      logger.warn('[REGISTER] Password confirmation mismatch');
      return res.render('login', {
        uid,
        title: 'Create Account',
        error: 'Passwords do not match'
      });
    }
    
    // Get client ID from interaction details to determine the user pool
    const details = await provider.interactionDetails(req, res);
    const clientId = details.params.client_id as string;
    
    if (!clientId) {
      logger.error('[REGISTER] No client ID found in interaction details');
      return res.render('login', {
        uid,
        title: 'Create Account',
        error: 'Invalid client configuration'
      });
    }
    
    // Get the user pool for this client
    const dataProvider = getDataProvider();
    const userPool = await dataProvider.getUserPoolByClientId(clientId);
    
    if (!userPool) {
      logger.error('[REGISTER] No user pool found for client:', clientId);
      return res.render('login', {
        uid,
        title: 'Create Account',
        error: 'Client configuration error'
      });
    }
    
    try {
      // Check if user already exists
      const existingUser = await Account.findByEmail(email, userPool.poolId);
      if (existingUser) {
        logger.warn('[REGISTER] User already exists:', email);
        return res.render('login', {
          uid,
          title: 'Create Account',
          error: 'An account with this email already exists'
        });
      }
      
      // Create new user account
      const newAccount = await Account.create({
        email,
        password,
        given_name,
        family_name
      }, userPool.poolId);
      
      logger.info('[REGISTER] Account created successfully:', {
        accountId: newAccount.accountId,
        email: newAccount.profile.email,
        mfaRequested: !!enable_mfa
      });
      
      // If MFA was requested, redirect to MFA setup instead of auto-login
      if (enable_mfa) {
        logger.info('[REGISTER] MFA setup requested, redirecting to setup wizard');
        
        // Store user info in session for MFA setup
        req.session.mfaSetup = {
          accountId: String(newAccount.accountId),
          poolId: userPool.poolId,
          email: newAccount.profile.email,
          interactionUid: uid,
          clientId: details.params.client_id as string,
          redirectUri: details.params.redirect_uri as string,
          clientState: details.params.state as string,
          codeChallenge: details.params.code_challenge as string,
          codeChallengeMethod: details.params.code_challenge_method as string,
          scope: details.params.scope as string
        };
        
        // Redirect to MFA setup page
        return res.redirect(`/mfa/setup?uid=${uid}`);
      }
      
      // Automatically log in the new user (no MFA case)
      const result = {
        login: {
          accountId: String(newAccount.accountId),
          remember: false,
        },
      };
      
      logger.info('[REGISTER] Completing interaction with login result:', result);
      await provider.interactionFinished(req, res, result);
      
    } catch (createError) {
      logger.error('[REGISTER] Error creating account:', createError);
      return res.render('login', {
        uid,
        title: 'Create Account',
        error: 'Failed to create account. Please try again.'
      });
    }
    
  } catch (error) {
    logger.error('[REGISTER] Registration error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      uid: req.params.uid
    });
    return res.status(500).render('error', {
      title: 'Registration Error',
      message: 'An error occurred during registration',
    });
  }
});

// Forgot password handler for interaction flow
router.post('/:uid/forgot-password', async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    const { email } = req.body;
    
    logger.info(`[FORGOT] Password reset requested for UID: ${uid}`, { email });
    
    // For now, just show a success message
    // In a real implementation, you would:
    // 1. Generate a secure reset token
    // 2. Store it in the database with expiration
    // 3. Send an email with the reset link
    
    return res.render('login', {
      uid,
      title: 'Password Reset',
      success: 'If an account with this email exists, you will receive a password reset link shortly.'
    });
    
  } catch (error) {
    logger.error('[FORGOT] Forgot password error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      uid: req.params.uid
    });
    return res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred while processing your request',
    });
  }
});

// MFA Verification during login
router.post('/:uid/mfa-verify', async (req: Request, res: Response) => {
  try {
    const provider = req.app.locals.provider as Provider;
    const { uid } = req.params;
    const { totpCode } = req.body;
    
    logger.info(`[MFA_VERIFY] POST received for UID: ${uid}`, {
      hasTotpCode: !!totpCode,
      totpCodeLength: totpCode?.length
    });
    
    // Get MFA verification info from session
    const mfaVerification = req.session?.mfaVerification;
    
    if (!mfaVerification || mfaVerification.interactionUid !== uid) {
      logger.warn('[MFA_VERIFY] No MFA verification session found');
      return res.render('mfa-verify', {
        uid,
        title: 'Two-Factor Authentication',
        error: 'Invalid verification session. Please try logging in again.'
      });
    }
    
    if (!totpCode || totpCode.length !== 6) {
      logger.warn('[MFA_VERIFY] Invalid TOTP code format');
      return res.render('mfa-verify', {
        uid,
        title: 'Two-Factor Authentication',
        error: 'Please enter a valid 6-digit code.'
      });
    }
    
    // Import MfaService
    const { MfaService } = await import('../services/mfa-service.js');
    
    // Verify TOTP code
    const verifyResult = await MfaService.verifyTotpForAuthentication(
      mfaVerification.poolId,
      mfaVerification.accountId,
      totpCode
    );
    
    if (!verifyResult.valid) {
      logger.warn('[MFA_VERIFY] Invalid TOTP code provided');
      return res.render('mfa-verify', {
        uid,
        title: 'Two-Factor Authentication',
        error: 'Invalid verification code. Please try again.'
      });
    }
    
    logger.info('[MFA_VERIFY] TOTP verification successful, completing login');
    
    // Clear MFA verification session
    delete req.session.mfaVerification;
    
    // Complete the OIDC interaction
    const result = {
      login: {
        accountId: mfaVerification.accountId,
      },
    };
    
    logger.info('[MFA_VERIFY] Completing interaction with result:', result);
    await provider.interactionFinished(req, res, result);
    
  } catch (error) {
    logger.error('MFA verification error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      uid: req.params.uid
    });
    
    return res.render('mfa-verify', {
      uid: req.params.uid,
      title: 'Two-Factor Authentication',
      error: 'An error occurred during verification. Please try again.'
    });
  }
});

// MFA Backup Code Verification during login
router.post('/:uid/mfa-verify-backup', async (req: Request, res: Response) => {
  try {
    const provider = req.app.locals.provider as Provider;
    const { uid } = req.params;
    const { backupCode } = req.body;
    
    logger.info(`[MFA_BACKUP] POST received for UID: ${uid}`, {
      hasBackupCode: !!backupCode
    });
    
    // Get MFA verification info from session
    const mfaVerification = req.session?.mfaVerification;
    
    if (!mfaVerification || mfaVerification.interactionUid !== uid) {
      logger.warn('[MFA_BACKUP] No MFA verification session found');
      return res.render('mfa-verify', {
        uid,
        title: 'Two-Factor Authentication',
        error: 'Invalid verification session. Please try logging in again.'
      });
    }
    
    if (!backupCode || backupCode.trim().length === 0) {
      logger.warn('[MFA_BACKUP] No backup code provided');
      return res.render('mfa-verify', {
        uid,
        title: 'Two-Factor Authentication',
        error: 'Please enter a valid backup code.'
      });
    }
    
    // Import MfaService
    const { MfaService } = await import('../services/mfa-service.js');
    
    // Verify backup code
    const verifyResult = await MfaService.verifyBackupCode(
      mfaVerification.poolId,
      mfaVerification.accountId,
      backupCode.trim()
    );
    
    if (!verifyResult.valid) {
      logger.warn('[MFA_BACKUP] Invalid backup code provided');
      return res.render('mfa-verify', {
        uid,
        title: 'Two-Factor Authentication',
        error: 'Invalid backup code. Please try again.'
      });
    }
    
    logger.info('[MFA_BACKUP] Backup code verification successful, completing login');
    
    // Clear MFA verification session
    delete req.session.mfaVerification;
    
    // Complete the OIDC interaction
    const result = {
      login: {
        accountId: mfaVerification.accountId,
      },
    };
    
    logger.info('[MFA_BACKUP] Completing interaction with result:', result);
    await provider.interactionFinished(req, res, result);
    
  } catch (error) {
    logger.error('MFA backup verification error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      uid: req.params.uid
    });
    
    return res.render('mfa-verify', {
      uid: req.params.uid,
      title: 'Two-Factor Authentication',
      error: 'An error occurred during verification. Please try again.'
    });
  }
});

export { router as authRoutes };
