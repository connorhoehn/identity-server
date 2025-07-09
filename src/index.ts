import express from 'express';
import session from 'express-session';
import { Provider } from 'oidc-provider';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { configuration, initializeOidcClients } from './config/oidc-config.js';
import { setupDatabase } from './database/setup.js';
import { authRoutes } from './routes/auth-multi-tenant.js';
import { adminRoutes as adminMultiTenantRoutes } from './routes/admin-multi-tenant.js';
import { adminRoutes } from './routes/admin.js';
import { mfaRoutes } from './routes/mfa.js';
import { mfaDashboardRoutes } from './routes/mfa-dashboard.js';
import { adminMfaRoutes } from './routes/admin-mfa.js';

import { errorHandler } from './middleware/error-handler.js';
import { logger } from './utils/logger.js';
import { DataProviderFactory } from './providers/data-provider-factory.js';
import { ClientStore } from './models/client-store-multi-tenant.js';

dotenv.config();

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3005;

async function startServer() {
    try {
        // Initialize data provider first
        await DataProviderFactory.initialize();
        logger.info('Data provider initialized');

        // Initialize default clients and user pools
        await ClientStore.initializeDefaults();
        logger.info('Default clients and pools initialized');

        // Initialize OIDC clients
        await initializeOidcClients();
        logger.info('OIDC clients loaded');

        // Initialize database (for backward compatibility with existing PostgreSQL setups)
        if (process.env.DATA_PROVIDER === 'postgresql') {
            await setupDatabase();
        }

        // Initialize OIDC Provider with Docker-aware issuer
        const issuer = process.env.ISSUER || 'http://localhost:3005';
        const provider = new Provider(issuer, configuration);
        
        // Store external issuer for browser redirects
        (app as any).externalIssuer = process.env.EXTERNAL_ISSUER || issuer;

        // Configure proxy for trusted headers (important for production)
        (provider as any).proxy = true;

        // Middleware to set trusted proxy headers
        app.set('trust proxy', true);

        // Add event listeners for debugging
        (provider as any).on('authorization.accepted', (ctx: any) => {
            logger.info('Authorization accepted', { 
                client_id: ctx.oidc.client?.clientId,
                account_id: ctx.oidc.session?.accountId,
                params: ctx.oidc?.params,
                state: ctx.oidc?.params?.state,
                redirect_uri: ctx.oidc?.params?.redirect_uri
            });
        });

        (provider as any).on('authorization.error', (ctx: any, err: any) => {
            logger.error('Authorization error:', {
                error: err.message,
                name: err.name,
                client_id: ctx.oidc?.client?.clientId || ctx.query?.client_id,
                path: ctx.path,
                method: ctx.method,
                headers: ctx.headers,
                params: ctx.oidc?.params,
                state: ctx.oidc?.params?.state
            });
        });

        (provider as any).on('grant.success', (ctx: any) => {
            logger.info('Grant successful', { 
                client_id: ctx.oidc.client?.clientId,
                account_id: ctx.oidc.account?.accountId,
                scopes: ctx.oidc.accessToken?.scope,
                params: ctx.oidc?.params,
                state: ctx.oidc?.params?.state
            });
        });

        (provider as any).on('grant.error', (ctx: any, err: any) => {
            logger.error('Grant error:', {
                error: err.message,
                name: err.name,
                client_id: ctx.oidc?.client?.clientId,
                path: ctx.path,
                params: ctx.oidc?.params,
                state: ctx.oidc?.params?.state
            });
        });

        (provider as any).on('interaction.started', (ctx: any, interaction: any) => {
            logger.info('[OIDC] Interaction started', { 
                uid: interaction.uid,
                client_id: ctx.oidc?.client?.clientId,
                prompt: interaction.prompt?.name,
                promptReasons: interaction.prompt?.reasons,
                session_exists: !!interaction.session,
                params: ctx.oidc?.params,
                state: ctx.oidc?.params?.state,
                path: ctx.path,
                method: ctx.method,
                cookies: ctx.cookies,
                headers: ctx.headers
            });
        });

        (provider as any).on('interaction.ended', (ctx: any) => {
            logger.info('[OIDC] Interaction ended', { 
                client_id: ctx.oidc?.client?.clientId,
                path: ctx.path,
                method: ctx.method,
                params: ctx.oidc?.params,
                state: ctx.oidc?.params?.state,
                result: ctx.oidc?.result,
                location: ctx.response?.get?.('Location'),
                status: ctx.status,
                headers: ctx.response?.header,
                cookies: ctx.cookies
            });
        });

        // Add more detailed event logging
        (provider as any).on('server_error', (ctx: any, err: any) => {
            logger.error('[OIDC] Server error:', {
                error: err.message,
                stack: err.stack,
                name: err.name,
                path: ctx.path,
                method: ctx.method,
                client_id: ctx.oidc?.client?.clientId,
                params: ctx.oidc?.params,
                state: ctx.oidc?.params?.state
            });
        });

        (provider as any).on('authorization.success', (ctx: any) => {
            logger.info('[OIDC] Authorization success', {
                client_id: ctx.oidc?.client?.clientId,
                account_id: ctx.oidc?.session?.accountId,
                params: ctx.oidc?.params,
                state: ctx.oidc?.params?.state,
                redirect_uri: ctx.oidc?.params?.redirect_uri,
                location: ctx.response?.get?.('Location')
            });
        });

        (provider as any).on('code.consumed', (ctx: any) => {
            logger.info('[OIDC] Authorization code consumed', {
                client_id: ctx.oidc?.client?.clientId,
                account_id: ctx.oidc?.account?.accountId,
                params: ctx.oidc?.params
            });
        });

        (provider as any).on('access_token.issued', (ctx: any) => {
            logger.info('[OIDC] Access token issued', {
                client_id: ctx.oidc?.client?.clientId,
                account_id: ctx.oidc?.account?.accountId,
                scopes: ctx.oidc?.accessToken?.scope
            });
        });

        (provider as any).on('jwks.error', (ctx: any, err: any) => {
            logger.error('[OIDC] JWKS error:', {
                error: err.message,
                path: ctx.path
            });
        });

        // Add session debugging
        (provider as any).on('session.destroyed', (ctx: any) => {
            logger.info('Session destroyed', {
                account_id: ctx.oidc?.session?.accountId
            });
        });

        (provider as any).on('session.saved', (ctx: any) => {
            logger.debug('Session saved', {
                account_id: ctx.oidc?.session?.accountId
            });
        });

        // Store provider in app locals for routes to access
        app.locals.provider = provider;

        // Middleware to rewrite discovery document for browser compatibility
        app.get('/.well-known/openid-configuration', (req, res, next) => {
            // Get the original discovery document
            const originalHandler = provider.callback();
            
            // Capture the original response
            const originalSend = res.send.bind(res);
            res.send = ((data: any) => {
                try {
                    const discovery = JSON.parse(data);
                    const externalIssuer = process.env.EXTERNAL_ISSUER || process.env.ISSUER;
                    
                    if (externalIssuer && externalIssuer !== discovery.issuer) {
                        // Rewrite browser-facing URLs to use external issuer (localhost)
                        const internalIssuer = discovery.issuer;
                        discovery.issuer = externalIssuer;
                        discovery.authorization_endpoint = discovery.authorization_endpoint?.replace(internalIssuer, externalIssuer);
                        discovery.end_session_endpoint = discovery.end_session_endpoint?.replace(internalIssuer, externalIssuer);
                        
                        // Keep server-to-server endpoints with internal URLs
                        // (token_endpoint, userinfo_endpoint, jwks_uri stay as-is)
                        
                        logger.info('Rewritten discovery document for browser compatibility', {
                            original_issuer: internalIssuer,
                            external_issuer: externalIssuer,
                            auth_endpoint: discovery.authorization_endpoint,
                            token_endpoint: discovery.token_endpoint
                        });
                    }
                    
                    data = JSON.stringify(discovery, null, 2);
                } catch (error) {
                    logger.error('Error rewriting discovery document:', error);
                }
                
                // Call the original send method
                return originalSend(data);
            }) as any;
            
            // Call the original handler
            originalHandler(req, res, next);
        });

        const directives = helmet.contentSecurityPolicy.getDefaultDirectives();
        delete directives['form-action'];
        
        // Update CSP to allow local assets and some external scripts for admin UI
        directives['script-src'] = [
            "'self'",
            "'unsafe-inline'",
            'https://cdn.jsdelivr.net'  // Still needed for some Bootstrap components
        ];
        directives['script-src-attr'] = ["'unsafe-inline'"];
        directives['style-src'] = [
            "'self'",
            "'unsafe-inline'"  // All CSS is now local
        ];
        directives['font-src'] = [
            "'self'"  // All fonts are now local
        ];
        
        app.use(helmet({
            contentSecurityPolicy: {
                useDefaults: false,
                directives,
            },
        }));

        app.use(cors({
            origin: true,
            credentials: true,
        }));

        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        
        // Session middleware for MFA setup flow
        app.use(session({
            secret: process.env.SESSION_SECRET || 'dev-session-secret-change-in-production',
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: process.env.NODE_ENV === 'production',
                httpOnly: true,
                maxAge: 1000 * 60 * 60 * 24 // 24 hours
            }
        }));
        
        // Cookie parser for session handling
        app.use(cookieParser(process.env.COOKIE_KEYS || 'some-secret-key-here'));

        // Static files - serve local assets
        app.use('/static', express.static(path.join(__dirname, '../public')));
        app.use('/css', express.static(path.join(__dirname, '../public/css')));
        app.use('/js', express.static(path.join(__dirname, '../public/js')));
        app.use('/fonts', express.static(path.join(__dirname, '../public/fonts')));
        app.use('/webfonts', express.static(path.join(__dirname, '../public/webfonts')));

        // Set view engine
        app.set('view engine', 'ejs');
        app.set('views', path.join(__dirname, '../views'));

        // Comprehensive request logging middleware
        app.use((req, res, next) => {
            const start = Date.now();
            const reqId = Math.random().toString(36).substr(2, 9);
            
            logger.info(`[REQ-${reqId}] ${req.method} ${req.path}`, {
                reqId,
                method: req.method,
                path: req.path,
                originalUrl: req.originalUrl,
                baseUrl: req.baseUrl,
                query: req.query,
                body: req.method === 'POST' ? req.body : undefined,
                headers: req.headers,
                cookies: req.headers.cookie,
                userAgent: req.headers['user-agent'],
                ip: req.ip,
                timestamp: new Date().toISOString()
            });
            
            // Log response details
            res.on('finish', () => {
                const duration = Date.now() - start;
                logger.info(`[RES-${reqId}] ${res.statusCode} in ${duration}ms`, {
                    reqId,
                    method: req.method,
                    path: req.path,
                    statusCode: res.statusCode,
                    duration,
                    contentType: res.get('Content-Type'),
                    location: res.get('Location'),
                    setCookie: res.get('Set-Cookie'),
                    contentLength: res.get('Content-Length'),
                    cacheControl: res.get('Cache-Control'),
                    hasLocation: !!res.get('Location'),
                    timestamp: new Date().toISOString()
                });
            });
            
            next();
        });

        // Application routes - mount auth routes on /interaction path to avoid conflict with OIDC provider
        app.use('/interaction', authRoutes);
        app.use('/admin', adminRoutes); // Single-tenant admin routes  
        app.use('/admin-multi', adminMultiTenantRoutes); // Multi-tenant admin routes
        app.use('/api/mfa', mfaRoutes);
        app.use('/api/admin/mfa', adminMfaRoutes);
        app.use('/mfa', mfaDashboardRoutes);


        // Add logout confirmation routes back as /auth routes (these are separate from OIDC interaction flow)
        app.get('/auth/logout-confirm', async (req, res) => {
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

        app.post('/auth/logout-confirm', async (req, res) => {
            try {
                const { action, post_logout_redirect_uri, client_id, id_token_hint } = req.body;
                
                if (action === 'logout') {
                    // User confirmed logout - redirect to actual OIDC logout endpoint
                    const logoutUrl = new URL('/session/end', `http://localhost:${PORT}`);
                    if (post_logout_redirect_uri) logoutUrl.searchParams.set('post_logout_redirect_uri', post_logout_redirect_uri as string);
                    if (client_id) logoutUrl.searchParams.set('client_id', client_id as string);
                    if (id_token_hint) logoutUrl.searchParams.set('id_token_hint', id_token_hint as string);
                    
                    logger.info('User confirmed logout, redirecting to:', logoutUrl.toString());
                    return res.redirect(logoutUrl.toString());
                } else {
                    // User chose to stay signed in - redirect back to client
                    logger.info('User chose to stay signed in, redirecting to:', post_logout_redirect_uri);
                    if (post_logout_redirect_uri) {
                        const redirectUrl = new URL(post_logout_redirect_uri as string);
                        redirectUrl.searchParams.set('stayed_signed_in', 'true');
                        return res.redirect(redirectUrl.toString());
                    } else {
                        // No redirect URI provided, just show a message
                        return res.render('logout', {
                            title: 'Logout Cancelled',
                            message: 'You chose to stay signed in.',
                        });
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

        // Root route
        app.get('/', (req, res) => {
            res.render('index', {
                title: 'Local Identity Server',
                issuer: process.env.ISSUER,
            });
        });

        // Health check
        app.get('/health', (req, res) => {
            res.status(200).json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                version: process.env.npm_package_version || '1.0.0',
                environment: process.env.NODE_ENV || 'development'
            });
        });

        // Add response logging middleware to debug redirects
        app.use((req, res, next) => {
            if (req.path.includes('/interaction/') || req.path.includes('/auth/') || req.path.includes('/.well-known/')) {
                res.on('finish', () => {
                    logger.info('Response finished:', {
                        path: req.path,
                        method: req.method,
                        status: res.statusCode,
                        contentType: res.get('Content-Type'),
                        location: res.get('Location'),
                        hasLocation: !!res.get('Location'),
                        locationHasState: res.get('Location')?.includes('state='),
                        stateInLocation: res.get('Location')?.match(/state=([^&]*)/)?.[1]
                    });
                });
            }
            
            next();
        });

        // Add callback logging for debugging
        app.use('/interaction', (req, res, next) => {
            if (req.path.includes('/callback') || req.method === 'GET') {
                logger.info('Interaction route accessed:', {
                    path: req.path,
                    method: req.method,
                    query: req.query,
                    cookies: req.headers.cookie,
                    userAgent: req.headers['user-agent']
                });
            }
            next();
        });

        // Test MFA setup page (development only)
        if (process.env.NODE_ENV !== 'production') {
            app.get('/mfa-test', (req, res) => {
                res.sendFile(path.join(__dirname, '../views/mfa-setup.html'));
            });
        }

        // OIDC Provider routes - MUST be last
        app.use(provider.callback());

        // Error handling AFTER OIDC provider
        app.use(errorHandler);

        app.listen(PORT, () => {
            logger.info(`Identity Server running on http://localhost:${PORT}`);
            logger.info(`OIDC Provider available at http://localhost:${PORT}`);
            logger.info(`Discovery endpoint: http://localhost:${PORT}/.well-known/openid-configuration`);
        });

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
