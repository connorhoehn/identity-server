import { Router, Request, Response } from 'express';
import { Account } from '../models/account-multi-tenant.js';
import { ClientStore } from '../models/client-store-multi-tenant.js';
import { getDataProvider } from '../providers/data-provider-factory.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Admin dashboard
router.get('/', async (req: Request, res: Response) => {
  try {
    const dataProvider = getDataProvider();
    const userPools = await dataProvider.listUserPools();
    const clients = await dataProvider.listClients();
    
    // Get total users across all pools
    let totalUsers = 0;
    for (const pool of userPools) {
      const { users } = await dataProvider.listUsers(pool.poolId, 1000); // Get up to 1000 users for accurate count
      totalUsers += users.length;
    }
    
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: {
        userPools: userPools.length,
        clients: clients.length,
        totalUsers,
      },
      userPools,
    });
  } catch (error) {
    logger.error('Error loading dashboard:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load dashboard',
    });
  }
});

// User Pool management
router.get('/pools', async (req: Request, res: Response) => {
  try {
    const dataProvider = getDataProvider();
    const userPools = await dataProvider.listUserPools();
    
    res.render('admin/pools', {
      title: 'User Pool Management',
      userPools,
    });
  } catch (error) {
    logger.error('Error fetching user pools:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to fetch user pools',
    });
  }
});

// User management (pool-specific)
router.get('/pools/:poolId/users', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const dataProvider = getDataProvider();
    
    const userPool = await dataProvider.getUserPool(poolId);
    if (!userPool) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'User pool not found',
      });
    }
    
    const users = await Account.findAll(poolId);
    res.render('admin/users', {
      title: `User Management - ${userPool.poolName}`,
      users,
      userPool,
      poolId,
    });
  } catch (error) {
    logger.error('Error fetching users:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to fetch users',
    });
  }
});

// Default user management (for backward compatibility)
router.get('/users', async (req: Request, res: Response) => {
  try {
    const defaultPoolId = await Account.getDefaultPoolId();
    res.redirect(`/admin/pools/${defaultPoolId}/users`);
  } catch (error) {
    logger.error('Error redirecting to default pool:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load users',
    });
  }
});

// Create user form (backward compatibility redirect)
router.get('/users/new', async (req: Request, res: Response) => {
  try {
    const defaultPoolId = await Account.getDefaultPoolId();
    res.redirect(`/admin/pools/${defaultPoolId}/users/new`);
  } catch (error) {
    logger.error('Error redirecting to default pool user form:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load user form',
    });
  }
});

// Create user form
router.get('/pools/:poolId/users/new', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const dataProvider = getDataProvider();
    
    const userPool = await dataProvider.getUserPool(poolId);
    if (!userPool) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'User pool not found',
      });
    }
    
    res.render('admin/user-form', {
      title: `Create New User - ${userPool.poolName}`,
      user: {},
      userPool,
      poolId,
      isEdit: false,
      customAttributes: userPool.customAttributes,
    });
  } catch (error) {
    logger.error('Error loading user form:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load user form',
    });
  }
});

// Create user
router.post('/pools/:poolId/users', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const { email, password, given_name, family_name, nickname, ...customAttributes } = req.body;
    
    const dataProvider = getDataProvider();
    const userPool = await dataProvider.getUserPool(poolId);
    if (!userPool) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'User pool not found',
      });
    }
    
    // Filter custom attributes based on pool configuration
    const poolCustomAttrs = userPool.customAttributes || {};
    const filteredCustomAttrs: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(customAttributes)) {
      if (poolCustomAttrs[key] && value) {
        filteredCustomAttrs[key] = value;
      }
    }
    
    await Account.create({
      email,
      password,
      given_name,
      family_name,
      nickname,
      customAttributes: filteredCustomAttrs,
    }, poolId);
    
    res.redirect(`/admin/pools/${poolId}/users`);
  } catch (error) {
    logger.error('Error creating user:', error);
    
    const dataProvider = getDataProvider();
    const userPool = await dataProvider.getUserPool(req.params.poolId);
    
    const errorMessage = error instanceof Error && error.message.includes('already exists') 
      ? 'A user with this email already exists' 
      : 'Failed to create user';
    
    res.render('admin/user-form', {
      title: `Create New User - ${userPool?.poolName || 'Unknown Pool'}`,
      user: req.body,
      userPool,
      poolId: req.params.poolId,
      isEdit: false,
      customAttributes: userPool?.customAttributes || {},
      error: errorMessage,
    });
  }
});

// Edit user form
router.get('/pools/:poolId/users/:id/edit', async (req: Request, res: Response) => {
  try {
    const { poolId, id } = req.params;
    const dataProvider = getDataProvider();
    
    const userPool = await dataProvider.getUserPool(poolId);
    if (!userPool) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'User pool not found',
      });
    }
    
    const user = await dataProvider.getUser(poolId, id);
    if (!user) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'User not found',
      });
    }
    
    res.render('admin/user-form', {
      title: `Edit User - ${userPool.poolName}`,
      user: {
        id: user.userId,
        email: user.email,
        given_name: user.givenName,
        family_name: user.familyName,
        nickname: user.nickname,
        picture: user.picture,
        website: user.website,
        ...user.customAttributes,
      },
      userPool,
      poolId,
      isEdit: true,
      customAttributes: userPool.customAttributes,
    });
  } catch (error) {
    logger.error('Error loading edit user form:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load user',
    });
  }
});

// Update user
router.post('/pools/:poolId/users/:id', async (req: Request, res: Response) => {
  try {
    const { poolId, id } = req.params;
    const { email, password, given_name, family_name, nickname, picture, website, ...customAttributes } = req.body;
    
    const dataProvider = getDataProvider();
    const userPool = await dataProvider.getUserPool(poolId);
    if (!userPool) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'User pool not found',
      });
    }
    
    // Filter custom attributes based on pool configuration
    const poolCustomAttrs = userPool.customAttributes || {};
    const filteredCustomAttrs: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(customAttributes)) {
      if (poolCustomAttrs[key]) {
        filteredCustomAttrs[key] = value || null;
      }
    }
    
    const updateData: any = {
      email,
      given_name,
      family_name,
      nickname,
      picture,
      website,
      customAttributes: filteredCustomAttrs,
    };
    
    if (password) {
      updateData.password = password;
    }
    
    await Account.update(id, updateData, poolId);
    res.redirect(`/admin/pools/${poolId}/users`);
  } catch (error) {
    logger.error('Error updating user:', error);
    
    const dataProvider = getDataProvider();
    const userPool = await dataProvider.getUserPool(req.params.poolId);
    
    res.render('admin/user-form', {
      title: `Edit User - ${userPool?.poolName || 'Unknown Pool'}`,
      user: { id: req.params.id, ...req.body },
      userPool,
      poolId: req.params.poolId,
      isEdit: true,
      customAttributes: userPool?.customAttributes || {},
      error: 'Failed to update user',
    });
  }
});

// Delete user
router.post('/pools/:poolId/users/:id/delete', async (req: Request, res: Response) => {
  try {
    const { poolId, id } = req.params;
    await Account.delete(id, poolId);
    res.redirect(`/admin/pools/${poolId}/users`);
  } catch (error) {
    logger.error('Error deleting user:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to delete user',
    });
  }
});

// Client/Application management
router.get('/applications', async (req: Request, res: Response) => {
  try {
    const dataProvider = getDataProvider();
    const clients = await dataProvider.listClients();
    
    // Get user pool info for each client
    const clientsWithPools = await Promise.all(
      clients.map(async (client) => {
        const userPool = await dataProvider.getUserPool(client.poolId);
        return {
          ...client,
          poolName: userPool?.poolName || 'Unknown Pool',
        };
      })
    );
    
    res.render('admin/applications', {
      title: 'Application Management',
      applications: clientsWithPools,
    });
  } catch (error) {
    logger.error('Error fetching applications:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to fetch applications',
    });
  }
});

// Create application form
router.get('/applications/new', async (req: Request, res: Response) => {
  try {
    const dataProvider = getDataProvider();
    const userPools = await dataProvider.listUserPools();
    
    res.render('admin/application-form', {
      title: 'Create New Application',
      client: {},
      userPools,
      isEdit: false,
    });
  } catch (error) {
    logger.error('Error loading application form:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load application form',
    });
  }
});

// Create application
router.post('/applications', async (req: Request, res: Response) => {
  try {
    const { 
      client_id, 
      client_secret, 
      client_name, 
      pool_id,
      redirect_uris,
      post_logout_redirect_uris,
      scope,
      application_type 
    } = req.body;
    
    const redirectUrisArray = redirect_uris.split('\n').map((uri: string) => uri.trim()).filter((uri: string) => uri);
    const postLogoutUrisArray = post_logout_redirect_uris 
      ? post_logout_redirect_uris.split('\n').map((uri: string) => uri.trim()).filter((uri: string) => uri)
      : [];
    
    await ClientStore.createClient({
      client_id,
      client_secret,
      client_name,
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: redirectUrisArray,
      post_logout_redirect_uris: postLogoutUrisArray,
      response_types: ['code'],
      scope: scope || 'openid profile email',
      token_endpoint_auth_method: 'client_secret_basic',
      application_type: application_type || 'web',
    }, pool_id);
    
    res.redirect('/admin/applications');
  } catch (error) {
    logger.error('Error creating application:', error);
    
    const dataProvider = getDataProvider();
    const userPools = await dataProvider.listUserPools();
    
    res.render('admin/application-form', {
      title: 'Create New Application',
      client: req.body,
      userPools,
      isEdit: false,
      error: 'Failed to create application',
    });
  }
});

// API endpoint to provision a new client (for external apps)
router.post('/api/provision-client', async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      client_name, 
      redirect_uris, 
      post_logout_redirect_uris,
      scope,
      create_user_pool = true,
      custom_attributes = {}
    } = req.body;
    
    if (!client_name || !redirect_uris) {
      res.status(400).json({ error: 'client_name and redirect_uris are required' });
      return;
    }
    
    const dataProvider = getDataProvider();
    
    // Generate client credentials
    const clientId = `client-${Date.now()}`;
    const clientSecret = `secret-${Math.random().toString(36).substring(2, 15)}`;
    
    let poolId: string;
    
    if (create_user_pool) {
      // Create a new user pool for this client
      poolId = `pool-${clientId}`;
      
      await dataProvider.createUserPool({
        poolId,
        clientId,
        poolName: `Pool for ${client_name}`,
        customAttributes: custom_attributes,
        settings: {
          passwordPolicy: {
            minLength: 8,
            requireUppercase: true,
            requireLowercase: true,
            requireNumbers: true,
            requireSymbols: false,
          },
          mfaConfiguration: 'OFF',
          accountRecovery: {
            email: true,
            sms: false,
          },
        },
      });
    } else {
      // Use the default pool
      poolId = await Account.getDefaultPoolId();
    }
    
    // Create the client
    await ClientStore.createClient({
      client_id: clientId,
      client_secret: clientSecret,
      client_name,
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: Array.isArray(redirect_uris) ? redirect_uris : [redirect_uris],
      post_logout_redirect_uris: post_logout_redirect_uris ? 
        (Array.isArray(post_logout_redirect_uris) ? post_logout_redirect_uris : [post_logout_redirect_uris]) : [],
      response_types: ['code'],
      scope: scope || 'openid profile email',
      token_endpoint_auth_method: 'client_secret_basic',
      application_type: 'web',
    }, poolId);
    
    res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret,
      pool_id: poolId,
      message: 'Client provisioned successfully',
    });
  } catch (error) {
    logger.error('Error provisioning client:', error);
    res.status(500).json({ error: 'Failed to provision client' });
  }
});

// API endpoint to delete a client
router.delete('/api/clients/:clientId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params;
    const { delete_user_pool = false } = req.body;
    
    const dataProvider = getDataProvider();
    const client = await dataProvider.getClient(clientId);
    
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }
    
    // Delete the client
    await ClientStore.deleteClient(clientId);
    
    // Optionally delete the user pool if requested and no other clients use it
    if (delete_user_pool) {
      const otherClients = await dataProvider.listClients(client.poolId);
      if (otherClients.length === 0) {
        await dataProvider.deleteUserPool(client.poolId);
      }
    }
    
    res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    logger.error('Error deleting client:', error);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

// API routes for statistics (AJAX endpoints)
router.get('/api/pools/:poolId/stats', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const dataProvider = getDataProvider();
    
    const userPool = await dataProvider.getUserPool(poolId);
    if (!userPool) {
      return res.status(404).json({ error: 'User pool not found' });
    }
    
    const { users } = await dataProvider.listUsers(poolId, 1000);
    
    return res.json({
      userCount: users.length,
      poolId,
      poolName: userPool.poolName,
    });
  } catch (error) {
    logger.error('Error fetching pool stats:', error);
    return res.status(500).json({ error: 'Failed to fetch pool statistics' });
  }
});

router.get('/api/clients/stats', async (req: Request, res: Response) => {
  try {
    const dataProvider = getDataProvider();
    const clients = await dataProvider.listClients();
    
    return res.json({
      activeCount: clients.length,
      totalCount: clients.length,
    });
  } catch (error) {
    logger.error('Error fetching client stats:', error);
    return res.status(500).json({ error: 'Failed to fetch client statistics' });
  }
});

// Create pool form
router.get('/pools/new', async (req: Request, res: Response) => {
  try {
    res.render('admin/pool-form', {
      title: 'Create New User Pool',
      pool: {},
      isEdit: false,
    });
  } catch (error) {
    logger.error('Error loading pool form:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load pool form',
    });
  }
});

// Create pool
router.post('/pools', async (req: Request, res: Response) => {
  try {
    const dataProvider = getDataProvider();
    const { poolName, clientId, customAttributes, settings } = req.body;
    
    // Generate pool ID if not provided
    const poolId = req.body.poolId || `pool-${Date.now()}`;
    
    const newPool = await dataProvider.createUserPool({
      poolId,
      clientId: clientId || `client-${Date.now()}`,
      poolName,
      customAttributes: customAttributes ? JSON.parse(customAttributes) : {},
      settings: settings ? JSON.parse(settings) : {
        passwordPolicy: {
          minLength: 8,
          requireUppercase: true,
          requireLowercase: true,
          requireNumbers: true,
          requireSymbols: false,
        },
        mfaConfiguration: 'OFF',
        accountRecovery: {
          email: true,
          sms: false,
        },
      },
    });
    
    logger.info(`Created new user pool: ${poolId}`);
    res.redirect(`/admin/pools/${poolId}/users`);
  } catch (error) {
    logger.error('Error creating pool:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to create pool',
    });
  }
});

export { router as adminRoutes };
