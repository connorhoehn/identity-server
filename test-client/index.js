import express from 'express';
import session from 'express-session';
import { Issuer, generators } from 'openid-client';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3006;

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'test-client-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store for code verifiers (in production, use Redis or similar)
const codeVerifiers = new Map();

// Initialize OIDC client
let client = null;

async function initializeOIDCClient() {
  try {
    // Use internal Docker hostname for server-to-server discovery
    const internalDiscoveryUrl = process.env.INTERNAL_ISSUER_URL || 'http://identity-server:3005';
    
    console.log(`Discovering OIDC issuer at: ${internalDiscoveryUrl}`);
    
    const issuer = await Issuer.discover(internalDiscoveryUrl);
    
    console.log('Discovery document loaded:');
    console.log('- Issuer:', issuer.issuer);
    console.log('- Authorization endpoint:', issuer.authorization_endpoint);
    console.log('- Token endpoint:', issuer.token_endpoint);
    console.log('- Userinfo endpoint:', issuer.userinfo_endpoint);
    console.log('- End session endpoint:', issuer.end_session_endpoint);
    
    client = new issuer.Client({
      client_id: process.env.CLIENT_ID || 'local-test-client',
      client_secret: process.env.CLIENT_SECRET || 'local-test-client-secret',
      redirect_uris: [process.env.REDIRECT_URI || 'http://localhost:3006/callback'],
      response_types: ['code'],
    });

    console.log('OIDC Client initialized successfully');
  } catch (error) {
    console.error('Failed to initialize OIDC client:', error);
    // Don't exit, allow manual retry
  }
}

// Routes
app.get('/', (req, res) => {
  const userInfo = req.session.userInfo;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>OIDC Test Client</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        .container { background: #f5f5f5; padding: 30px; border-radius: 8px; }
        .user-info { background: #e8f5e9; padding: 20px; border-radius: 4px; margin: 20px 0; }
        .error { background: #ffebee; color: #c62828; padding: 20px; border-radius: 4px; margin: 20px 0; }
        button, a { background: #007bff; color: white; padding: 12px 24px; border: none; border-radius: 4px; text-decoration: none; display: inline-block; margin: 10px 10px 10px 0; cursor: pointer; }
        button:hover, a:hover { background: #0056b3; }
        .logout { background: #dc3545; }
        .logout:hover { background: #c82333; }
        pre { background: #f8f9fa; padding: 15px; border-radius: 4px; overflow-x: auto; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>OIDC Test Client</h1>
        <p>This is a simple test client to validate the OIDC identity server functionality.</p>
        
        ${!client ? '<div class="error">⚠️ OIDC Client not initialized. <a href="/init">Try to initialize</a></div>' : ''}
        
        ${userInfo ? `
          <div class="user-info">
            <h3>✅ Authentication Successful!</h3>
            <p><strong>Welcome, ${userInfo.email || userInfo.sub}!</strong></p>
            <details>
              <summary>User Information</summary>
              <pre>${JSON.stringify(userInfo, null, 2)}</pre>
            </details>
            <a href="/logout" class="logout">Logout</a>
          </div>
        ` : `
          <div>
            <h3>Not authenticated</h3>
            <p>Click the button below to test the OIDC authentication flow:</p>
            ${client ? '<a href="/login">🔐 Login with Identity Server</a>' : '<p>Cannot login - OIDC client not initialized</p>'}
          </div>
        `}
        
        <div style="margin-top: 40px;">
          <h3>Configuration</h3>
          <ul>
            <li><strong>Issuer URL:</strong> ${(process.env.ISSUER_URL || 'http://localhost:3005').replace('identity-server:3005', 'localhost:3005')}</li>
            <li><strong>Client ID:</strong> ${process.env.CLIENT_ID || 'local-test-client'}</li>
            <li><strong>Redirect URI:</strong> ${process.env.REDIRECT_URI || 'http://localhost:3006/callback'}</li>
          </ul>
        </div>
        
        <div style="margin-top: 20px;">
          <a href="/test-discovery">🔍 Test Discovery Endpoint</a>
          <a href="/init">🔄 Reinitialize Client</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/init', async (req, res) => {
  await initializeOIDCClient();
  res.redirect('/');
});

app.get('/login', (req, res) => {
  if (!client) {
    return res.status(500).send('OIDC client not initialized. <a href="/init">Initialize</a>');
  }

  try {
    const state = generators.state();
    
    // Try with PKCE first, fallback to basic flow if needed
    const authParams = {
      scope: 'openid profile email',
      state,
    };
    
    // Only add PKCE if the server supports it
    if (process.env.USE_PKCE !== 'false') {
      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);
      
      // Store code verifier for later use
      codeVerifiers.set(state, codeVerifier);
      
      authParams.code_challenge = codeChallenge;
      authParams.code_challenge_method = 'S256';
    }

    const authUrl = client.authorizationUrl(authParams);

    // Rewrite internal Docker hostname to localhost for browser compatibility
    const browserAuthUrl = authUrl.replace('identity-server:3005', 'localhost:3005');

    console.log('Original auth URL:', authUrl);
    console.log('Browser auth URL:', browserAuthUrl);
    res.redirect(browserAuthUrl);
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.get('/callback', async (req, res) => {
  if (!client) {
    return res.status(500).send('OIDC client not initialized');
  }

  try {
    const { code, state, error } = req.query;

    if (error) {
      console.error('OIDC Error:', error);
      return res.status(400).send(`OIDC Error: ${error}`);
    }

    if (!code || !state) {
      return res.status(400).send('Missing code or state parameter');
    }

    // Get code verifier if PKCE was used
    const codeVerifier = codeVerifiers.get(state);
    const usedPKCE = !!codeVerifier;
    
    if (usedPKCE) {
      // Clean up the code verifier
      codeVerifiers.delete(state);
    }

    console.log('Exchanging code for tokens...');
    console.log('Callback query params:', req.query);
    console.log('State from URL:', state);
    console.log('PKCE used:', usedPKCE);
    
    // Prepare callback parameters
    const callbackParams = { state };
    if (usedPKCE) {
      callbackParams.code_verifier = codeVerifier;
    }
    
    const tokenSet = await client.callback(
      process.env.REDIRECT_URI || 'http://localhost:3006/callback',
      req.query,
      callbackParams
    );

    console.log('Token exchange successful');
    console.log('Access Token:', tokenSet.access_token ? '✅ Received' : '❌ Missing');
    console.log('ID Token:', tokenSet.id_token ? '✅ Received' : '❌ Missing');

    // Get user info
    const userInfo = await client.userinfo(tokenSet.access_token);
    console.log('User info retrieved:', userInfo);

    // Store user info in session
    req.session.userInfo = userInfo;
    req.session.tokens = {
      access_token: tokenSet.access_token,
      id_token: tokenSet.id_token,
      refresh_token: tokenSet.refresh_token,
    };

    res.redirect('/');
  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).send(`Callback error: ${error.message}`);
  }
});

app.get('/logout', async (req, res) => {
  if (!client) {
    req.session.destroy(() => {
      res.redirect('/');
    });
    return;
  }

  try {
    const tokens = req.session.tokens;
    
    // Don't destroy the session yet - let the user decide on the confirmation page
    if (tokens && tokens.id_token) {
      const logoutConfirmUrl = new URL('/auth/logout-confirm', 'http://localhost:3005');
      logoutConfirmUrl.searchParams.set('id_token_hint', tokens.id_token);
      logoutConfirmUrl.searchParams.set('post_logout_redirect_uri', 'http://localhost:3006/logout-callback');
      logoutConfirmUrl.searchParams.set('client_id', process.env.CLIENT_ID || 'local-test-client');
      
      console.log('Redirecting to logout confirmation (session preserved):', logoutConfirmUrl.toString());
      
      res.redirect(logoutConfirmUrl.toString());
    } else {
      res.redirect('/');
    }
  } catch (error) {
    console.error('Logout error:', error);
    req.session.destroy(() => {
      res.redirect('/');
    });
  }
});

// New endpoint to handle the post-logout callback
app.get('/logout-callback', (req, res) => {
  // Check if user chose to stay signed in
  const stayedSignedIn = req.query.stayed_signed_in === 'true';
  
  if (stayedSignedIn) {
    console.log('User chose to stay signed in - preserving session');
    res.redirect('/');
  } else {
    // User actually logged out (came through the OIDC logout endpoint)
    console.log('User completed logout - destroying session');
    req.session.destroy(() => {
      res.redirect('/');
    });
  }
});

app.get('/test-discovery', async (req, res) => {
  try {
    const issuerUrl = process.env.ISSUER_URL || 'http://localhost:3005';
    const response = await fetch(`${issuerUrl}/.well-known/openid-configuration`);
    const discovery = await response.json();
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Discovery Endpoint Test</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
          pre { background: #f8f9fa; padding: 15px; border-radius: 4px; overflow-x: auto; }
        </style>
      </head>
      <body>
        <h1>OIDC Discovery Document</h1>
        <p><strong>Endpoint:</strong> http://localhost:3005/.well-known/openid-configuration</p>
        <pre>${JSON.stringify(discovery, null, 2)}</pre>
        <a href="/">← Back to home</a>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`Error fetching discovery document: ${error.message}`);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    oidc_client_initialized: !!client 
  });
});

app.listen(PORT, async () => {
  console.log(`OIDC Test Client running on http://localhost:${PORT}`);
  console.log('Initializing OIDC client...');
  await initializeOIDCClient();
});
