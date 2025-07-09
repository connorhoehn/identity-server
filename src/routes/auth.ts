import { Router, Request, Response } from 'express';
import { Provider } from 'oidc-provider';
import { Account } from '../models/account-multi-tenant.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Interaction endpoints
router.get('/:uid', async (req: Request, res: Response) => {
  try {
    const provider = req.app.locals.provider as Provider;
    const details = await provider.interactionDetails(req, res);
    
    const { uid, prompt, params } = details;
    
    logger.info(`Processing interaction for UID: ${uid}`, {
      prompt: prompt.name,
      client_id: params.client_id,
      session_exists: !!details.session,
      cookies: req.headers.cookie
    });
    
    if (prompt.name === 'login') {
      return res.render('login', {
        uid,
        details: prompt.details,
        params,
        title: 'Sign In',
        csrfToken: '',
      });
    }
    
    if (prompt.name === 'consent') {
      logger.info(`Rendering consent page for UID: ${uid}`);
      logger.info('Prompt details:', prompt.details);
      logger.info('Request cookies:', req.headers.cookie);
      
      return res.render('consent', {
        uid,
        details: prompt.details,
        params,
        title: 'Authorize Application',
        csrfToken: '',
      });
    }
    
    return res.status(501).render('error', {
      title: 'Error',
      message: `Unknown prompt: ${prompt.name}`,
    });
  } catch (error) {
    logger.error('Interaction error:', error);
    
    // Check if it's a session not found error
    if (error && typeof error === 'object' && 'name' in error) {
      const oidcError = error as any;
      if (oidcError.name === 'SessionNotFound') {
        return res.status(400).render('error', {
          title: 'Session Error',
          message: 'Your session has expired. Please start the authorization process again.',
        });
      }
    }
    
    return res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred during the interaction',
    });
  }
});

// Debug endpoint to check interaction details
router.get('/:uid/debug', async (req: Request, res: Response) => {
  try {
    const provider = req.app.locals.provider as Provider;
    const details = await provider.interactionDetails(req, res);
    
    const debugInfo = {
      interaction: {
        uid: details.uid,
        prompt: details.prompt,
        params: details.params,
        session: details.session ? {
          accountId: details.session.accountId,
          loginTs: details.session.loginTs,
          acr: details.session.acr,
          amr: details.session.amr
        } : null,
        grantId: details.grantId,
        result: details.result
      },
      request: {
        cookies: req.headers.cookie,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        method: req.method,
        path: req.path
      }
    };
    
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
    
    logger.info(`Login POST received for UID: ${uid}`, {
      email,
      hasPassword: !!password,
      body: req.body,
      cookies: req.headers.cookie
    });
    
    // Get client ID from interaction details to determine the user pool
    const details = await provider.interactionDetails(req, res);
    const clientId = details.params.client_id as string;
    
    logger.info('Interaction details for login:', {
      uid: details.uid,
      clientId,
      prompt: details.prompt,
      params: details.params
    });
    
    if (!clientId) {
      logger.error('No client ID found in interaction details');
      return res.render('login', {
        uid,
        error: 'Invalid client configuration',
        title: 'Sign In',
        csrfToken: '',
      });
    }
    
    logger.info(`Attempting to authenticate user: ${email} for client: ${clientId}`);
    const account = await Account.authenticate(email, password, clientId);
    
    if (!account) {
      logger.warn(`Authentication failed for user: ${email}`);
      return res.render('login', {
        uid,
        error: 'Invalid email or password',
        title: 'Sign In',
        csrfToken: '',
      });
    }
    
    logger.info(`Authentication successful for user: ${email}, accountId: ${account.accountId}`);
    
    const result = {
      login: {
        accountId: account.accountId,
      },
    };
    
    logger.info('Finishing interaction with result:', result);
    const finishResult = await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
    logger.info('Interaction finished successfully, result:', finishResult);
  } catch (error) {
    logger.error('Login error:', error);
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
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type']
      },
      body: req.body,
      query: req.query
    });
    
    const interactionDetails = await provider.interactionDetails(req, res);
    
    logger.info('Full interaction details:', {
      uid: interactionDetails.uid,
      prompt: interactionDetails.prompt,
      params: interactionDetails.params,
      session: interactionDetails.session,
      grantId: interactionDetails.grantId,
      result: interactionDetails.result,
      lastSubmission: interactionDetails.lastSubmission
    });
    
    const { prompt: { name, details }, params, session: { accountId } } = interactionDetails;
    
    // Validate interaction state
    if (name !== 'consent') {
      logger.error(`Expected consent prompt, but got: ${name}`);
      return res.status(400).render('error', {
        title: 'Error',
        message: 'Invalid interaction state',
      });
    }
    
    if (!accountId) {
      logger.error('No account ID found in session');
      return res.status(400).render('error', {
        title: 'Authentication Error',
        message: 'No authenticated user found. Please login first.',
      });
    }
    
    // Log state parameter specifically
    logger.info('State parameter analysis:', {
      stateInParams: !!params.state,
      stateValue: params.state,
      allParams: Object.keys(params),
      paramsString: JSON.stringify(params, null, 2)
    });
    
    // Handle grant creation/update
    let { grantId } = interactionDetails;
    let grant;
    
    if (grantId) {
      // Modifying existing grant
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
      // Creating new grant
      grant = new provider.Grant({
        accountId,
        clientId: params.client_id as string,
      });
      logger.info(`Creating new grant for account: ${accountId}, client: ${params.client_id}`);
    }
    
    // Add scopes and claims as needed
    if (details.missingOIDCScope) {
      grant.addOIDCScope(details.missingOIDCScope.join(' '));
      logger.info(`Added OIDC scopes: ${details.missingOIDCScope.join(' ')}`);
    }
    
    if (details.missingOIDCClaims) {
      grant.addOIDCClaims(details.missingOIDCClaims);
      logger.info(`Added OIDC claims: ${JSON.stringify(details.missingOIDCClaims)}`);
    }
    
    if (details.missingResourceScopes) {
      for (const [indicator, scopes] of Object.entries(details.missingResourceScopes)) {
        grant.addResourceScope(indicator, (scopes as string[]).join(' '));
        logger.info(`Added resource scopes for ${indicator}: ${(scopes as string[]).join(' ')}`);
      }
    }
    
    // Save the grant
    grantId = await grant.save();
    logger.info(`Grant saved with ID: ${grantId}`);
    
    // Prepare the result
    const consent: any = {};
    if (!interactionDetails.grantId) {
      consent.grantId = grantId;
    }
    
    const result = { consent };
    
    logger.info('About to finish interaction:', {
      uid: interactionDetails.uid,
      result: JSON.stringify(result),
      mergeWithLastSubmission: true,
      originalParams: interactionDetails.params,
      statePresent: !!interactionDetails.params?.state
    });
    
    // Finish the interaction
    await provider.interactionFinished(req, res, result, { 
      mergeWithLastSubmission: true 
    });
    
    logger.info('Interaction finished successfully');
    
  } catch (error) {
    logger.error('Consent confirmation error:', error);
    logger.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    // Check if it's a known OIDC error
    if (error && typeof error === 'object' && 'name' in error) {
      const oidcError = error as any;
      logger.error('OIDC Error details:', {
        name: oidcError.name,
        message: oidcError.message,
        status: oidcError.status,
        statusCode: oidcError.statusCode,
        error_description: oidcError.error_description
      });
      
      if (oidcError.name === 'SessionNotFound' || oidcError.name === 'InvalidGrant') {
        return res.status(400).render('error', {
          title: 'Session Error',
          message: 'Your session has expired. Please start the authorization process again.',
        });
      }
    }
    
    return res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred during consent confirmation',
    });
  }
});

router.post('/:uid/consent', async (req: Request, res: Response) => {
  // Legacy endpoint - redirect to the new confirm endpoint
  res.redirect(307, `/interaction/${req.params.uid}/confirm`);
});

router.get('/logout-confirm', async (req: Request, res: Response) => {
  try {
    const { post_logout_redirect_uri, client_id, id_token_hint } = req.query;
    
    logger.info('Logout confirmation requested', {
      post_logout_redirect_uri,
      client_id,
      id_token_hint: !!id_token_hint
    });
    
    res.render('logout-confirm', {
      title: 'Confirm Logout',
      post_logout_redirect_uri,
      client_id,
      id_token_hint,
    });
  } catch (error) {
    logger.error('Logout confirmation error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred while processing logout confirmation',
    });
  }
});

router.post('/logout-confirm', async (req: Request, res: Response) => {
  try {
    const { action, post_logout_redirect_uri, client_id, id_token_hint } = req.body;
    
    if (action === 'logout') {
      // User confirmed logout - redirect to actual OIDC logout endpoint
      const logoutUrl = new URL('/session/end', `http://localhost:${process.env.PORT || 3005}`);
      if (post_logout_redirect_uri) logoutUrl.searchParams.set('post_logout_redirect_uri', post_logout_redirect_uri);
      if (client_id) logoutUrl.searchParams.set('client_id', client_id);
      if (id_token_hint) logoutUrl.searchParams.set('id_token_hint', id_token_hint);
      
      logger.info('User confirmed logout, redirecting to:', logoutUrl.toString());
      return res.redirect(logoutUrl.toString());
    } else {
      // User chose to stay signed in - redirect back to client with a parameter
      logger.info('User chose to stay signed in, redirecting to:', post_logout_redirect_uri);
      if (post_logout_redirect_uri) {
        const redirectUrl = new URL(post_logout_redirect_uri);
        redirectUrl.searchParams.set('stayed_signed_in', 'true');
        return res.redirect(redirectUrl.toString());
      } else {
        return res.redirect('/');
      }
    }
  } catch (error) {
    logger.error('Logout confirmation POST error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred while processing logout confirmation',
    });
  }
});

router.get('/logout', async (req: Request, res: Response) => {
  try {
    const provider = req.app.locals.provider as Provider;
    const session = await provider.Session.get(req);
    
    if (session) {
      await session.destroy();
    }
    
    res.render('logout', {
      title: 'Logged Out',
      message: 'You have been successfully logged out',
    });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred during logout',
    });
  }
});

router.get('/:uid/abort', async (req: Request, res: Response) => {
  try {
    const provider = req.app.locals.provider as Provider;
    
    const result = {
      error: 'access_denied',
      error_description: 'End-User aborted interaction',
    };
    
    await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
  } catch (error) {
    logger.error('Interaction abort error:', error);
    return res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred while aborting the interaction',
    });
  }
});

router.post('/:uid/abort', async (req: Request, res: Response) => {
  try {
    const provider = req.app.locals.provider as Provider;
    
    const result = {
      error: 'access_denied',
      error_description: 'End-User aborted interaction',
    };
    
    await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
  } catch (error) {
    logger.error('Interaction abort error:', error);
    return res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred while aborting the interaction',
    });
  }
});

export { router as authRoutes };
