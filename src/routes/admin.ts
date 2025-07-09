import { Router, Request, Response } from 'express';
import { Account } from '../models/account.js';
import { Client } from '../models/client.js';
import { getDataProvider } from '../providers/data-provider-factory.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Admin dashboard
router.get('/', async (req: Request, res: Response) => {
  try {
    const dataProvider = getDataProvider();
    
    // Get user pools
    const userPools = await dataProvider.listUserPools();
    
    // Get all users across pools to count them
    let totalUsers = 0;
    for (const pool of userPools) {
      try {
        let nextToken: string | undefined;
        do {
          const result = await dataProvider.listUsers(pool.poolId, 100, nextToken);
          totalUsers += result.users.length;
          nextToken = result.nextToken;
        } while (nextToken);
      } catch (error) {
        logger.warn(`Failed to count users in pool ${pool.poolId}:`, error);
      }
    }
    
    // Get all clients
    const clients = await dataProvider.listClients();
    
    // Prepare stats object
    const stats = {
      userPools: userPools.length,
      totalUsers,
      clients: clients.length
    };
    
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats,
      userPools: userPools.slice(0, 5) // Show first 5 pools on dashboard
    });
  } catch (error) {
    logger.error('Error loading admin dashboard:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load dashboard data'
    });
  }
});

// User management
router.get('/users', async (req: Request, res: Response) => {
  try {
    const users = await Account.findAll();
    res.render('admin/users', {
      title: 'User Management',
      users,
      breadcrumbs: [
        { name: 'Admin', url: '/admin' },
        { name: 'Users', active: true }
      ]
    });
  } catch (error) {
    logger.error('Error fetching users:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to fetch users',
    });
  }
});

// Create user form
router.get('/users/new', (req: Request, res: Response) => {
  res.render('admin/user-form', {
    title: 'Create New User',
    user: {},
    isEdit: false,
    breadcrumbs: [
      { name: 'Admin', url: '/admin' },
      { name: 'Users', url: '/admin/users' },
      { name: 'New User', active: true }
    ]
  });
});

// Create user
router.post('/users', async (req: Request, res: Response) => {
  try {
    const { email, password, given_name, family_name, nickname } = req.body;
    
    const account = await Account.create({
      email,
      password,
      given_name,
      family_name,
      nickname,
    });
    
    res.redirect('/admin/users');
  } catch (error) {
    logger.error('Error creating user:', error);
    
    let errorMessage = 'Failed to create user';
    
    // Check if it's a duplicate email error
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      const pgError = error as any;
      if (pgError.constraint === 'users_email_key') {
        errorMessage = 'A user with this email address already exists';
      }
    }
    
    res.status(400).render('admin/user-form', {
      title: 'Create New User',
      user: req.body,
      isEdit: false,
      error: errorMessage,
    });
  }
});

// Edit user form
router.get('/users/:id/edit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = await Account.findAccount(null, id);
    
    if (!user) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'User not found',
      });
    }
    
    res.render('admin/user-form', {
      title: 'Edit User',
      user: {
        id: user.accountId,
        email: user.profile.email,
        given_name: user.profile.given_name,
        family_name: user.profile.family_name,
        nickname: user.profile.nickname,
      },
      isEdit: true,
      breadcrumbs: [
        { name: 'Admin', url: '/admin' },
        { name: 'Users', url: '/admin/users' },
        { name: `Edit ${user.profile.email}`, active: true }
      ]
    });
  } catch (error) {
    logger.error('Error fetching user for edit:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to fetch user details',
    });
  }
});

// Update user
router.post('/users/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { email, given_name, family_name, nickname, password } = req.body;
    
    // Check if user exists
    const existingUser = await Account.findAccount(null, id);
    if (!existingUser) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'User not found',
      });
    }
    
    // Update user (we'll need to add this method to Account model)
    await Account.update(id, {
      email,
      given_name,
      family_name,
      nickname,
      ...(password && { password }), // Only update password if provided
    });
    
    res.redirect('/admin/users');
  } catch (error) {
    logger.error('Error updating user:', error);
    
    let errorMessage = 'Failed to update user';
    
    // Check if it's a duplicate email error
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      const pgError = error as any;
      if (pgError.constraint === 'users_email_key') {
        errorMessage = 'A user with this email address already exists';
      }
    }
    
    res.status(400).render('admin/user-form', {
      title: 'Edit User',
      user: { id: req.params.id, ...req.body },
      isEdit: true,
      error: errorMessage,
    });
  }
});

// Delete user
router.post('/users/:id/delete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Check if user exists
    const existingUser = await Account.findAccount(null, id);
    if (!existingUser) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'User not found',
      });
    }
    
    // Delete user (we'll need to add this method to Account model)
    await Account.delete(id);
    
    res.redirect('/admin/users');
  } catch (error) {
    logger.error('Error deleting user:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to delete user',
    });
  }
});

// Application management
router.get('/applications', async (req: Request, res: Response) => {
  try {
    const clients = await Client.findAll();
    // Transform to consistent format for the template
    const applications = clients.map(client => ({
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      response_types: client.responseTypes,
      scope: client.scope,
      application_type: 'web', // Default type
      client_uri: null, // Not stored in current model
      disabled: false, // Not stored in current model
      created_at: client.createdAt,
      updated_at: client.updatedAt
    }));
    
    res.render('admin/applications', {
      title: 'Application Management',
      applications,
      breadcrumbs: [
        { name: 'Admin', url: '/admin' },
        { name: 'Applications', active: true }
      ]
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
router.get('/applications/new', (req: Request, res: Response) => {
  res.render('admin/application-form', {
    title: 'Create New Application',
    application: {},
    isEdit: false,
    breadcrumbs: [
      { name: 'Admin', url: '/admin' },
      { name: 'Applications', url: '/admin/applications' },
      { name: 'New Application', active: true }
    ]
  });
});

// Create application
router.post('/applications', async (req: Request, res: Response) => {
  try {
    const { client_name, redirect_uris, grant_types, scope } = req.body;
    
    // Parse redirect URIs and grant types
    const redirectUrisArray = typeof redirect_uris === 'string' 
      ? redirect_uris.split('\n').map(uri => uri.trim()).filter(uri => uri) 
      : redirect_uris;
    
    const grantTypesArray = Array.isArray(grant_types) ? grant_types : [grant_types].filter(Boolean);
    
    const client = await Client.create({
      client_name,
      redirect_uris: redirectUrisArray,
      grant_types: grantTypesArray,
      scope: scope || 'openid profile email',
    });
    
    res.redirect('/admin/applications');
  } catch (error) {
    logger.error('Error creating application:', error);
    res.status(500).render('admin/application-form', {
      title: 'Create New Application',
      application: req.body,
      isEdit: false,
      error: 'Failed to create application',
    });
  }
});

// Edit application form
router.get('/applications/:id/edit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const client = await Client.findByClientId(id);
    
    if (!client) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'Application not found',
      });
    }
    
    res.render('admin/application-form', {
      title: 'Edit Application',
      application: client,
      isEdit: true,
      breadcrumbs: [
        { name: 'Admin', url: '/admin' },
        { name: 'Applications', url: '/admin/applications' },
        { name: `Edit ${client.clientName || client.clientId}`, active: true }
      ]
    });
  } catch (error) {
    logger.error('Error fetching application for edit:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to fetch application details',
    });
  }
});

// Update application
router.post('/applications/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { client_name, redirect_uris, grant_types, scope } = req.body;
    
    // Parse redirect URIs and grant types
    const redirectUrisArray = typeof redirect_uris === 'string' 
      ? redirect_uris.split('\n').map(uri => uri.trim()).filter(uri => uri) 
      : redirect_uris;
    
    const grantTypesArray = Array.isArray(grant_types) ? grant_types : [grant_types].filter(Boolean);
    
    // Find the client first to get the internal ID
    const client = await Client.findByClientId(id);
    if (!client) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'Application not found',
      });
    }
    
    await Client.update(client.id, {
      client_name,
      redirect_uris: redirectUrisArray,
      grant_types: grantTypesArray,
      scope: scope || 'openid profile email',
    });
    
    res.redirect('/admin/applications');
  } catch (error) {
    logger.error('Error updating application:', error);
    res.status(500).render('admin/application-form', {
      title: 'Edit Application',
      application: req.body,
      isEdit: true,
      error: 'Failed to update application',
    });
  }
});

// Delete application
router.delete('/applications/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Find the client first to get the internal ID
    const client = await Client.findByClientId(id);
    if (!client) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }
    
    const success = await Client.delete(client.id);
    return res.json({ success });
  } catch (error) {
    logger.error('Error deleting application:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete application' });
  }
});

// Create pool form
router.get('/pools/new', (req: Request, res: Response) => {
  res.render('admin/pool-form', {
    title: 'Create New Pool',
    pool: {},
    isEdit: false,
    breadcrumbs: [
      { name: 'Admin', url: '/admin' },
      { name: 'New Pool', active: true }
    ]
  });
});

// Create pool
router.post('/pools', async (req: Request, res: Response) => {
  try {
    const { poolName, clientId, settings } = req.body;
    
    const dataProvider = getDataProvider();
    await dataProvider.createUserPool({
      poolId: `pool-${Date.now()}`, // Generate unique pool ID
      clientId: clientId || `client-${Date.now()}`,
      poolName,
      customAttributes: {},
      settings: settings || {}
    });
    
    res.redirect('/admin');
  } catch (error) {
    logger.error('Error creating pool:', error);
    res.status(500).render('admin/pool-form', {
      title: 'Create New Pool',
      pool: req.body,
      isEdit: false,
      error: 'Failed to create pool',
    });
  }
});

// Edit pool form
router.get('/pools/:id/edit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dataProvider = getDataProvider();
    const pool = await dataProvider.getUserPool(id);
    
    if (!pool) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'Pool not found',
      });
    }
    
    res.render('admin/pool-form', {
      title: 'Edit Pool',
      pool,
      isEdit: true,
      breadcrumbs: [
        { name: 'Admin', url: '/admin' },
        { name: `Edit ${pool.poolName}`, active: true }
      ]
    });
  } catch (error) {
    logger.error('Error fetching pool for edit:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to fetch pool details',
    });
  }
});

// Update pool
router.post('/pools/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { poolName, settings } = req.body;
    
    const dataProvider = getDataProvider();
    await dataProvider.updateUserPool(id, {
      poolName,
      settings: settings || {}
    });
    
    res.redirect('/admin');
  } catch (error) {
    logger.error('Error updating pool:', error);
    res.status(500).render('admin/pool-form', {
      title: 'Edit Pool',
      pool: { id: req.params.id, ...req.body },
      isEdit: true,
      error: 'Failed to update pool',
    });
  }
});

// Delete pool
router.post('/pools/:id/delete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const dataProvider = getDataProvider();
    await dataProvider.deleteUserPool(id);
    
    res.redirect('/admin');
  } catch (error) {
    logger.error('Error deleting pool:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to delete pool',
    });
  }
});

// Pool-specific user management
router.get('/pools/:poolId/users', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const dataProvider = getDataProvider();
    
    // Get the pool details
    const pool = await dataProvider.getUserPool(poolId);
    if (!pool) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'Pool not found',
      });
    }

    // Get users from this specific pool
    const result = await dataProvider.listUsers(poolId, 100);
    const users = result.users;

    res.render('admin/users', {
      title: `Users in ${pool.poolName}`,
      users: users.map(user => ({
        id: user.userId,
        email: user.email,
        given_name: user.givenName,
        family_name: user.familyName,
        nickname: user.nickname,
        status: user.status,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      })),
      userPool: pool, // Changed from 'pool' to 'userPool' to match template
      poolId: poolId, // Add poolId for template
      poolSpecific: true,
      breadcrumbs: [
        { name: 'Admin', url: '/admin' },
        { name: pool.poolName, url: `/admin/pools/${poolId}/edit` },
        { name: 'Users', active: true }
      ]
    });
  } catch (error) {
    logger.error('Error fetching pool users:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to fetch pool users',
    });
  }
});

// Pool-specific client management
router.get('/pools/:poolId/clients', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const dataProvider = getDataProvider();
    
    // Get the pool details
    const pool = await dataProvider.getUserPool(poolId);
    if (!pool) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'Pool not found',
      });
    }

    // Get clients for this specific pool
    const clients = await dataProvider.listClients(poolId);

    res.render('admin/applications', {
      title: `Applications in ${pool.poolName}`,
      applications: clients.map(client => ({
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: client.grantTypes,
        scope: client.scope,
        createdAt: client.createdAt
      })),
      userPool: pool, // Changed from 'pool' to 'userPool' to match template expectations
      poolId: poolId, // Add poolId for template
      poolSpecific: true,
      breadcrumbs: [
        { name: 'Admin', url: '/admin' },
        { name: pool.poolName, url: `/admin/pools/${poolId}/edit` },
        { name: 'Applications', active: true }
      ]
    });
  } catch (error) {
    logger.error('Error fetching pool clients:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to fetch pool clients',
    });
  }
});

// Pool settings management
router.get('/pools/:poolId/settings', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const dataProvider = getDataProvider();
    
    // Get the pool details
    const pool = await dataProvider.getUserPool(poolId);
    if (!pool) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'Pool not found',
      });
    }

    res.render('admin/pool-form', {
      title: `Settings for ${pool.poolName}`,
      pool,
      isEdit: true,
      isSettings: true, // Flag to indicate this is settings view
      breadcrumbs: [
        { name: 'Admin', url: '/admin' },
        { name: pool.poolName, url: `/admin/pools/${poolId}/edit` },
        { name: 'Settings', active: true }
      ]
    });
  } catch (error) {
    logger.error('Error fetching pool settings:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to fetch pool settings',
    });
  }
});

// Pool-specific user edit form
router.get('/pools/:poolId/users/:userId/edit', async (req: Request, res: Response) => {
  try {
    const { poolId, userId } = req.params;
    const dataProvider = getDataProvider();
    
    // Get the pool details
    const pool = await dataProvider.getUserPool(poolId);
    if (!pool) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'Pool not found',
      });
    }

    // Get the user details
    const user = await dataProvider.getUser(poolId, userId);
    if (!user) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'User not found',
      });
    }

    res.render('admin/user-form', {
      title: `Edit User - ${user.email}`,
      user: {
        id: user.userId,
        email: user.email,
        given_name: user.givenName,
        family_name: user.familyName,
        nickname: user.nickname,
        status: user.status
      },
      userPool: pool,
      poolId: poolId,
      poolSpecific: true,
      isEdit: true,
      breadcrumbs: [
        { name: 'Admin', url: '/admin' },
        { name: pool.poolName, url: `/admin/pools/${poolId}/edit` },
        { name: 'Users', url: `/admin/pools/${poolId}/users` },
        { name: `Edit ${user.email}`, active: true }
      ]
    });
  } catch (error) {
    logger.error('Error fetching user for edit:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to fetch user details',
    });
  }
});

// Pool-specific user update
router.post('/pools/:poolId/users/:userId', async (req: Request, res: Response) => {
  try {
    const { poolId, userId } = req.params;
    const { email, given_name, family_name, nickname, password } = req.body;
    const dataProvider = getDataProvider();
    
    // Check if user exists
    const existingUser = await dataProvider.getUser(poolId, userId);
    if (!existingUser) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'User not found',
      });
    }
    
    // Update user
    await dataProvider.updateUser(poolId, userId, {
      email,
      givenName: given_name,
      familyName: family_name,
      nickname,
      ...(password && { passwordHash: password }) // Only update password if provided
    });
    
    res.redirect(`/admin/pools/${poolId}/users`);
  } catch (error) {
    logger.error('Error updating user:', error);
    
    let errorMessage = 'Failed to update user';
    
    // Check if it's a duplicate email error
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      const pgError = error as any;
      if (pgError.constraint === 'users_email_key') {
        errorMessage = 'A user with this email address already exists';
      }
    }
    
    res.status(400).render('admin/user-form', {
      title: 'Edit User',
      user: { id: req.params.userId, ...req.body },
      poolId: req.params.poolId,
      poolSpecific: true,
      isEdit: true,
      error: errorMessage,
    });
  }
});

// Pool-specific user deletion
router.post('/pools/:poolId/users/:userId/delete', async (req: Request, res: Response) => {
  try {
    const { poolId, userId } = req.params;
    const dataProvider = getDataProvider();
    
    // Check if user exists
    const existingUser = await dataProvider.getUser(poolId, userId);
    if (!existingUser) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'User not found',
      });
    }
    
    // Delete user
    await dataProvider.deleteUser(poolId, userId);
    
    res.redirect(`/admin/pools/${poolId}/users`);
  } catch (error) {
    logger.error('Error deleting user:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to delete user',
    });
  }
});

// Pool-specific new user form
router.get('/pools/:poolId/users/new', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const dataProvider = getDataProvider();
    
    // Get the pool details
    const pool = await dataProvider.getUserPool(poolId);
    if (!pool) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'Pool not found',
      });
    }

    res.render('admin/user-form', {
      title: `Create New User in ${pool.poolName}`,
      user: {},
      userPool: pool,
      poolId: poolId,
      poolSpecific: true,
      isEdit: false,
      breadcrumbs: [
        { name: 'Admin', url: '/admin' },
        { name: pool.poolName, url: `/admin/pools/${poolId}/edit` },
        { name: 'Users', url: `/admin/pools/${poolId}/users` },
        { name: 'New User', active: true }
      ]
    });
  } catch (error) {
    logger.error('Error loading new user form:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load user form',
    });
  }
});

// Pool-specific user creation
router.post('/pools/:poolId/users', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const { email, password, given_name, family_name, nickname } = req.body;
    const dataProvider = getDataProvider();
    
    // Create user in the specific pool
    await dataProvider.createUser({
      poolId,
      email,
      passwordHash: password, // In real implementation, this should be hashed
      givenName: given_name,
      familyName: family_name,
      nickname,
      emailVerified: false,
      customAttributes: {},
      groups: [],
      status: 'CONFIRMED',
      mfaEnabled: false
    });
    
    res.redirect(`/admin/pools/${poolId}/users`);
  } catch (error) {
    logger.error('Error creating user:', error);
    
    let errorMessage = 'Failed to create user';
    
    // Check if it's a duplicate email error
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      const pgError = error as any;
      if (pgError.constraint === 'users_email_key') {
        errorMessage = 'A user with this email address already exists';
      }
    }
    
    res.status(400).render('admin/user-form', {
      title: 'Create New User',
      user: req.body,
      poolId: req.params.poolId,
      poolSpecific: true,
      isEdit: false,
      error: errorMessage,
    });
  }
});

// API endpoints for pool statistics (used by JavaScript)
router.get('/api/pools/:poolId/stats', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const dataProvider = getDataProvider();
    
    // Set cache-busting headers
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    // Get user count for this pool
    let userCount = 0;
    let nextToken: string | undefined;
    
    do {
      const result = await dataProvider.listUsers(poolId, 100, nextToken);
      userCount += result.users.length;
      nextToken = result.nextToken;
    } while (nextToken);
    
    res.json({ userCount });
  } catch (error) {
    logger.error(`Error getting pool stats for ${req.params.poolId}:`, error);
    res.status(500).json({ error: 'Failed to get pool statistics' });
  }
});

// API endpoint for client statistics
router.get('/api/clients/stats', async (req: Request, res: Response) => {
  try {
    const dataProvider = getDataProvider();
    
    // Set cache-busting headers
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    const clients = await dataProvider.listClients();
    
    res.json({ 
      activeCount: clients.length,
      totalCount: clients.length 
    });
  } catch (error) {
    logger.error('Error getting client stats:', error);
    res.status(500).json({ error: 'Failed to get client statistics' });
  }
});

// Create application with pool form
router.get('/applications/new-with-pool', (req: Request, res: Response) => {
  res.render('admin/application-pool-form', {
    title: 'Create Application with Pool',
    application: {},
    pool: {},
    isEdit: false,
    breadcrumbs: [
      { name: 'Admin', url: '/admin' },
      { name: 'Applications', url: '/admin/applications' },
      { name: 'New Application + Pool', active: true }
    ]
  });
});

// Create application with pool
router.post('/applications/create-with-pool', async (req: Request, res: Response) => {
  try {
    const { 
      client_name, 
      redirect_uris, 
      grant_types, 
      scope,
      pool_name,
      mfa_configuration,
      password_min_length,
      password_require_uppercase,
      password_require_lowercase,
      password_require_numbers,
      password_require_symbols
    } = req.body;
    
    // Parse redirect URIs and grant types
    const redirectUrisArray = typeof redirect_uris === 'string' 
      ? redirect_uris.split('\n').map(uri => uri.trim()).filter(uri => uri) 
      : redirect_uris;
    
    const grantTypesArray = Array.isArray(grant_types) ? grant_types : [grant_types].filter(Boolean);
    
    // Generate unique IDs
    const poolId = `pool-${Date.now()}`;
    const clientId = `client-${Date.now()}`;
    
    // Create the pool first
    const dataProvider = getDataProvider();
    await dataProvider.createUserPool({
      poolId,
      clientId,
      poolName: pool_name,
      customAttributes: {},
      settings: {
        mfaConfiguration: mfa_configuration || 'OFF',
        passwordPolicy: {
          minLength: parseInt(password_min_length) || 8,
          requireUppercase: !!password_require_uppercase,
          requireLowercase: !!password_require_lowercase,
          requireNumbers: !!password_require_numbers,
          requireSymbols: !!password_require_symbols
        }
      }
    });
    
    // Create the application/client
    await Client.create({
      client_id: clientId,
      client_name,
      redirect_uris: redirectUrisArray,
      grant_types: grantTypesArray,
      scope: scope || 'openid profile email',
    });
    
    res.redirect('/admin/applications');
  } catch (error) {
    logger.error('Error creating application with pool:', error);
    res.status(500).render('admin/application-pool-form', {
      title: 'Create Application with Pool',
      application: req.body,
      pool: req.body,
      isEdit: false,
      error: 'Failed to create application and pool',
    });
  }
});

export { router as adminRoutes };
