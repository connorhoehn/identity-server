import { Router, Request, Response } from 'express';
import { getDataProvider } from '../providers/data-provider-factory.js';
import { requireAuth, requireAdmin, loadUserDetails, getCurrentUser } from '../middleware/session-auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * User MFA Dashboard
 * GET /mfa/dashboard
 */
router.get('/dashboard', requireAuth, loadUserDetails, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Get user details from database
    const dataProvider = getDataProvider();
    const userData = await dataProvider.getUser(user.poolId, user.userId);
    
    if (!userData) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Get user's MFA devices
    const mfaDevices = await dataProvider.listUserMfaDevices(user.poolId, user.userId);

    // Get pool information
    const pool = await dataProvider.getUserPool(user.poolId);

    // Render the MFA dashboard
    res.render('mfa-dashboard', {
      user: {
        id: user.userId,
        email: userData.email,
        poolId: user.poolId,
        name: userData.name || userData.givenName || userData.familyName,
        mfaEnabled: userData.mfaEnabled
      },
      devices: mfaDevices.map(device => ({
        id: device.deviceId,
        name: device.deviceName,
        type: device.deviceType,
        isVerified: device.isVerified,
        lastUsed: device.lastUsed,
        createdAt: device.createdAt
      })),
      poolName: pool?.poolName || 'Identity Server'
    });

  } catch (error) {
    logger.error('Error loading MFA dashboard:', error);
    res.status(500).json({ 
      error: 'Failed to load MFA dashboard',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Admin MFA Management Dashboard
 * GET /mfa/admin
 */
router.get('/admin', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const admin = getCurrentUser(req);
    if (!admin) {
      res.status(401).json({ error: 'Admin authentication required' });
      return;
    }

    // Render the admin MFA management dashboard
    res.render('admin/mfa-management', {
      admin: {
        email: admin.email
      },
      poolName: 'Identity Server'
    });

  } catch (error) {
    logger.error('Error loading admin MFA dashboard:', error);
    res.status(500).json({ 
      error: 'Failed to load admin MFA dashboard',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * MFA Setup Wizard
 * GET /mfa/setup
 */
router.get('/setup', async (req: Request, res: Response): Promise<void> => {
  try {
    const { uid } = req.query;
    
    // Check if there's MFA setup info in session
    const mfaSetup = req.session?.mfaSetup;
    
    if (!mfaSetup || !uid) {
      logger.warn('[MFA_SETUP] No MFA setup session found, redirecting to login');
      res.redirect('/');
      return;
    }
    
    // Get user details
    const dataProvider = getDataProvider();
    const user = await dataProvider.getUser(mfaSetup.poolId, mfaSetup.accountId);
    
    if (!user) {
      logger.error('[MFA_SETUP] User not found:', mfaSetup);
      res.status(404).render('error', {
        title: 'User Not Found',
        message: 'Could not find user for MFA setup'
      });
      return;
    }
    
    // Render the MFA setup page
    res.render('mfa-setup', {
      title: 'Set Up Two-Factor Authentication',
      user: {
        id: mfaSetup.accountId,
        email: mfaSetup.email,
        poolId: mfaSetup.poolId
      },
      uid: uid,
      step: 'setup'
    });
    
  } catch (error) {
    logger.error('Error loading MFA setup:', error);
    res.status(500).render('error', {
      title: 'Setup Error',
      message: 'Failed to load MFA setup page'
    });
  }
});

/**
 * Complete MFA Setup and continue with login
 * POST /mfa/setup/complete
 */
router.post('/setup/complete', async (req: Request, res: Response): Promise<void> => {
  try {
    const { uid } = req.body;
    
    // Get MFA setup info from session
    const mfaSetup = req.session?.mfaSetup;
    
    if (!mfaSetup || !uid) {
      logger.warn('[MFA_SETUP] No MFA setup session found for completion');
      res.status(400).json({ error: 'Invalid MFA setup session' });
      return;
    }
    
    // Clear the MFA setup session
    delete req.session.mfaSetup;
    
    // Try to complete the OIDC interaction
    try {
      const provider = req.app.locals.provider;
      const result = {
        login: {
          accountId: mfaSetup.accountId,
          remember: false,
        },
      };
      
      logger.info('[MFA_SETUP] Completing interaction after MFA setup:', result);
      await provider.interactionFinished(req, res, result);
      
    } catch (interactionError: any) {
      logger.warn('[MFA_SETUP] OIDC interaction expired, attempting to redirect to original client:', {
        error: interactionError.message,
        accountId: mfaSetup.accountId,
        email: mfaSetup.email,
        clientId: mfaSetup.clientId,
        redirectUri: mfaSetup.redirectUri
      });
      
      // Try to redirect user back to the original OIDC authorization endpoint
      // to re-initiate the OAuth flow with login_hint
      let clientRedirectUrl = '/?login_hint=' + encodeURIComponent(mfaSetup.email);
      
      if (mfaSetup.redirectUri && mfaSetup.clientId) {
        // Re-initiate the OAuth flow by redirecting to the authorization endpoint
        try {
          const authUrl = new URL('/auth', `${req.protocol}://${req.get('host')}`);
          authUrl.searchParams.set('response_type', 'code');
          authUrl.searchParams.set('client_id', mfaSetup.clientId);
          authUrl.searchParams.set('redirect_uri', mfaSetup.redirectUri);
          authUrl.searchParams.set('scope', mfaSetup.scope || 'openid profile email');
          authUrl.searchParams.set('login_hint', mfaSetup.email);
          
          // Use the original state parameter if available
          if (mfaSetup.clientState) {
            authUrl.searchParams.set('state', mfaSetup.clientState);
          }
          
          // Include PKCE parameters if available
          if (mfaSetup.codeChallenge && mfaSetup.codeChallengeMethod) {
            authUrl.searchParams.set('code_challenge', mfaSetup.codeChallenge);
            authUrl.searchParams.set('code_challenge_method', mfaSetup.codeChallengeMethod);
          }
          
          clientRedirectUrl = authUrl.toString();
          
          logger.info('[MFA_SETUP] Redirecting to authorization endpoint to re-initiate OAuth flow:', {
            clientId: mfaSetup.clientId,
            redirectUri: mfaSetup.redirectUri,
            state: mfaSetup.clientState,
            hasPKCE: !!(mfaSetup.codeChallenge && mfaSetup.codeChallengeMethod),
            authUrl: clientRedirectUrl
          });
          
        } catch (urlError: any) {
          logger.warn('[MFA_SETUP] Error building authorization URL, using fallback:', urlError.message);
        }
      } else {
        logger.warn('[MFA_SETUP] No client redirect info available, using identity server fallback');
      }
      
      // Return redirect URL to frontend
      res.json({
        success: true,
        message: 'MFA setup completed successfully! Redirecting you back to the application.',
        redirectUrl: clientRedirectUrl
      });
    }
    
  } catch (error) {
    logger.error('Error completing MFA setup:', error);
    res.status(500).json({ 
      error: 'Failed to complete MFA setup',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as mfaDashboardRoutes };
