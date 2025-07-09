import { Router, Request, Response } from 'express';
import { MfaService } from '../services/mfa-service.js';
import { getDataProvider } from '../providers/data-provider-factory.js';
import { UserData } from '../interfaces/data-provider.js';
import { requireAdmin, getCurrentUser } from '../middleware/session-auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * Get MFA metrics and overview
 * GET /api/admin/mfa/metrics
 */
router.get('/metrics', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const dataProvider = getDataProvider();
    
    // Get all users (in real implementation, you'd paginate this)
    const allUsers = await getAllUsers(dataProvider);
    const mfaEnabledUsers = allUsers.filter(user => user.mfaEnabled);
    
    // Get device statistics
    const deviceStats = await getMfaDeviceStats(dataProvider);
    
    const metrics = {
      totalUsers: allUsers.length,
      mfaEnabledUsers: mfaEnabledUsers.length,
      adoptionRate: allUsers.length > 0 ? (mfaEnabledUsers.length / allUsers.length * 100).toFixed(1) : 0,
      totalDevices: deviceStats.totalDevices,
      verifiedDevices: deviceStats.verifiedDevices,
      devicesByType: deviceStats.devicesByType
    };

    res.json({
      success: true,
      metrics
    });

  } catch (error) {
    logger.error('Error getting MFA metrics:', error);
    res.status(500).json({ 
      error: 'Failed to get MFA metrics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get user list with MFA status
 * GET /api/admin/mfa/users
 */
router.get('/users', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { poolId, page = 1, limit = 25 } = req.query;
    const dataProvider = getDataProvider();
    
    // Get users with MFA status
    const users = await getUsersWithMfaStatus(dataProvider, poolId as string);
    
    // Apply pagination
    const startIndex = (Number(page) - 1) * Number(limit);
    const endIndex = startIndex + Number(limit);
    const paginatedUsers = users.slice(startIndex, endIndex);
    
    // Get device counts for each user
    const usersWithDevices = await Promise.all(
      paginatedUsers.map(async (user) => {
        const devices = await MfaService.getUserMfaDevices(user.poolId, user.id.toString());
        return {
          ...user,
          deviceCount: devices.length,
          verifiedDevices: devices.filter(d => d.isVerified).length,
          lastLogin: user.lastLogin || null
        };
      })
    );

    res.json({
      success: true,
      users: usersWithDevices,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(users.length / Number(limit)),
        totalUsers: users.length,
        hasNext: endIndex < users.length,
        hasPrev: Number(page) > 1
      }
    });

  } catch (error) {
    logger.error('Error getting users with MFA status:', error);
    res.status(500).json({ 
      error: 'Failed to get users',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get user pools
 * GET /api/admin/mfa/pools
 */
router.get('/pools', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const dataProvider = getDataProvider();
    
    // Get all pools with user counts
    const pools = await dataProvider.listUserPools();
    const poolsWithCounts = await Promise.all(
      pools.map(async (pool) => {
        try {
          // Get user count for each pool
          const result = await dataProvider.listUsers(pool.poolId, 1); // Just get count
          let userCount = 0;
          let nextToken: string | undefined;
          
          // Count all users in paginated fashion
          do {
            const pageResult = await dataProvider.listUsers(pool.poolId, 100, nextToken);
            userCount += pageResult.users.length;
            nextToken = pageResult.nextToken;
          } while (nextToken);
          
          return {
            id: pool.poolId,
            name: pool.poolName,
            userCount
          };
        } catch (error) {
          logger.warn(`Failed to get user count for pool ${pool.poolId}:`, error);
          return {
            id: pool.poolId,
            name: pool.poolName,
            userCount: 0
          };
        }
      })
    );

    res.json({
      success: true,
      pools: poolsWithCounts
    });

  } catch (error) {
    logger.error('Error getting pools:', error);
    res.status(500).json({ 
      error: 'Failed to get pools',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Force enable MFA for a user
 * POST /api/admin/mfa/users/:poolId/:userId/force-enable
 */
router.post('/users/:poolId/:userId/force-enable', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { poolId, userId } = req.params;
    const dataProvider = getDataProvider();
    
    // Get user
    const user = await dataProvider.getUser(poolId, userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Force enable MFA (sets a flag that requires MFA setup on next login)
    await dataProvider.updateUser(poolId, userId, {
      ...user,
      mfaEnabled: true,
      customAttributes: {
        ...user.customAttributes,
        mfaForced: true,
        mfaForcedAt: new Date().toISOString()
      }
    });

    // Log the admin action
    const admin = getCurrentUser(req);
    logger.info('Admin force-enabled MFA for user', {
      adminAction: 'FORCE_ENABLE_MFA',
      adminUserId: admin?.userId || 'unknown',
      adminEmail: admin?.email || 'unknown',
      targetUserId: userId,
      targetPoolId: poolId,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'MFA force-enabled for user. They will be required to set up MFA on next login.'
    });

  } catch (error) {
    logger.error('Error force-enabling MFA:', error);
    res.status(500).json({ 
      error: 'Failed to force-enable MFA',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Reset user's MFA settings
 * POST /api/admin/mfa/users/:poolId/:userId/reset
 */
router.post('/users/:poolId/:userId/reset', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { poolId, userId } = req.params;
    const dataProvider = getDataProvider();
    
    // Get user
    const user = await dataProvider.getUser(poolId, userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Remove all MFA devices
    const devices = await MfaService.getUserMfaDevices(poolId, userId);
    await Promise.all(
      devices.map(device => 
        dataProvider.deleteMfaDevice(poolId, userId, device.deviceId)
      )
    );

    // Disable MFA for user
    await dataProvider.updateUserMfaStatus(poolId, userId, false);

    // Log the admin action
    const admin = getCurrentUser(req);
    logger.info('Admin reset MFA for user', {
      adminAction: 'RESET_MFA',
      adminUserId: admin?.userId || 'unknown',
      adminEmail: admin?.email || 'unknown',
      targetUserId: userId,
      targetPoolId: poolId,
      devicesRemoved: devices.length,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: `MFA settings reset for user. ${devices.length} devices removed.`
    });

  } catch (error) {
    logger.error('Error resetting user MFA:', error);
    res.status(500).json({ 
      error: 'Failed to reset MFA',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Disable MFA for a user
 * POST /api/admin/mfa/users/:poolId/:userId/disable
 */
router.post('/users/:poolId/:userId/disable', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { poolId, userId } = req.params;
    const dataProvider = getDataProvider();
    
    // Get user
    const user = await dataProvider.getUser(poolId, userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Remove all MFA devices
    const devices = await MfaService.getUserMfaDevices(poolId, userId);
    await Promise.all(
      devices.map(device => 
        dataProvider.deleteMfaDevice(poolId, userId, device.deviceId)
      )
    );

    // Disable MFA for user
    await dataProvider.updateUserMfaStatus(poolId, userId, false);

    // Remove any MFA enforcement flags
    await dataProvider.updateUser(poolId, userId, {
      ...user,
      mfaEnabled: false,
      customAttributes: {
        ...user.customAttributes,
        mfaForced: false,
        mfaDisabledAt: new Date().toISOString()
      }
    });

    // Log the admin action
    const admin = getCurrentUser(req);
    logger.info('Admin disabled MFA for user', {
      adminAction: 'DISABLE_MFA',
      adminUserId: admin?.userId || 'unknown',
      adminEmail: admin?.email || 'unknown',
      targetUserId: userId,
      targetPoolId: poolId,
      devicesRemoved: devices.length,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: `MFA disabled for user. ${devices.length} devices removed.`
    });

  } catch (error) {
    logger.error('Error disabling user MFA:', error);
    res.status(500).json({ 
      error: 'Failed to disable MFA',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Bulk enable MFA for multiple users
 * POST /api/admin/mfa/users/bulk-enable
 */
router.post('/users/bulk-enable', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userIds } = req.body;
    
    if (!Array.isArray(userIds) || userIds.length === 0) {
      res.status(400).json({ error: 'userIds array is required' });
      return;
    }

    const dataProvider = getDataProvider();
    const results = {
      successful: [] as string[],
      failed: [] as { userId: string, error: string }[]
    };

    // Process each user
    for (const userInfo of userIds) {
      try {
        const [poolId, userId] = userInfo.split(':');
        const user = await dataProvider.getUser(poolId, userId);
        
        if (user) {
          await dataProvider.updateUser(poolId, userId, {
            ...user,
            mfaEnabled: true,
            customAttributes: {
              ...user.customAttributes,
              mfaForced: true,
              mfaForcedAt: new Date().toISOString()
            }
          });
          results.successful.push(userInfo);
        } else {
          results.failed.push({ userId: userInfo, error: 'User not found' });
        }
      } catch (error) {
        results.failed.push({ 
          userId: userInfo, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }

    // Log the bulk admin action
    logger.info('Admin bulk-enabled MFA', {
      adminAction: 'BULK_ENABLE_MFA',
      successful: results.successful.length,
      failed: results.failed.length,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: `MFA enabled for ${results.successful.length} users. ${results.failed.length} failed.`,
      results
    });

  } catch (error) {
    logger.error('Error bulk-enabling MFA:', error);
    res.status(500).json({ 
      error: 'Failed to bulk-enable MFA',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get MFA audit logs
 * GET /api/admin/mfa/audit-logs
 */
router.get('/audit-logs', async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      eventType, 
      startDate, 
      endDate, 
      userId, 
      poolId, 
      page = 1, 
      limit = 50 
    } = req.query;

    // This would integrate with your audit logging system
    // For now, return mock data
    const auditLogs = generateMockAuditLogs();
    
    // Apply filters
    let filteredLogs = auditLogs;
    
    if (eventType) {
      filteredLogs = filteredLogs.filter(log => log.eventType === eventType);
    }
    
    if (startDate) {
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= new Date(startDate as string));
    }
    
    if (endDate) {
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= new Date(endDate as string));
    }

    // Apply pagination
    const startIndex = (Number(page) - 1) * Number(limit);
    const endIndex = startIndex + Number(limit);
    const paginatedLogs = filteredLogs.slice(startIndex, endIndex);

    res.json({
      success: true,
      logs: paginatedLogs,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(filteredLogs.length / Number(limit)),
        totalLogs: filteredLogs.length
      }
    });

  } catch (error) {
    logger.error('Error getting audit logs:', error);
    res.status(500).json({ 
      error: 'Failed to get audit logs',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Export audit logs
 * GET /api/admin/mfa/audit-logs/export
 */
router.get('/audit-logs/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const { format = 'csv', eventType, startDate, endDate } = req.query;
    
    // Get audit logs with filters
    const auditLogs = generateMockAuditLogs(); // Replace with actual query
    
    if (format === 'csv') {
      const csv = convertLogsToCSV(auditLogs);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="mfa-audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } else {
      res.json({
        success: true,
        logs: auditLogs
      });
    }

  } catch (error) {
    logger.error('Error exporting audit logs:', error);
    res.status(500).json({ 
      error: 'Failed to export audit logs',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Helper functions

async function getAllUsers(dataProvider: any): Promise<any[]> {
  try {
    // Get all pools first
    const pools = await dataProvider.listUserPools();
    let allUsers: any[] = [];
    
    for (const pool of pools) {
      try {
        // Get users from each pool with pagination
        let nextToken: string | undefined;
        do {
          const result = await dataProvider.listUsers(pool.poolId, 100, nextToken);
          allUsers = allUsers.concat(result.users.map((user: UserData) => ({
            id: user.userId,
            poolId: user.poolId,
            email: user.email,
            name: user.name || user.email,
            mfaEnabled: user.mfaEnabled,
            lastLogin: user.lastLogin,
            createdAt: user.createdAt,
            status: user.status
          })));
          nextToken = result.nextToken;
        } while (nextToken);
      } catch (error) {
        logger.warn(`Failed to get users from pool ${pool.poolId}:`, error);
      }
    }
    
    return allUsers;
  } catch (error) {
    logger.error('Error getting all users:', error);
    return [];
  }
}

async function getUsersWithMfaStatus(dataProvider: any, poolFilter?: string): Promise<any[]> {
  try {
    if (poolFilter) {
      // Get users from specific pool
      let allUsers: any[] = [];
      let nextToken: string | undefined;
      
      do {
        const result = await dataProvider.listUsers(poolFilter, 100, nextToken);
        allUsers = allUsers.concat(result.users.map((user: UserData) => ({
          id: user.userId,
          poolId: user.poolId,
          email: user.email,
          name: user.name || user.email,
          mfaEnabled: user.mfaEnabled,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
          status: user.status
        })));
        nextToken = result.nextToken;
      } while (nextToken);
      
      return allUsers;
    } else {
      return await getAllUsers(dataProvider);
    }
  } catch (error) {
    logger.error('Error getting users with MFA status:', error);
    return [];
  }
}

async function getMfaDeviceStats(dataProvider: any): Promise<any> {
  try {
    // Get all users and count their MFA devices
    const allUsers = await getAllUsers(dataProvider);
    let totalDevices = 0;
    let verifiedDevices = 0;
    const devicesByType: { [key: string]: number } = { TOTP: 0, SMS: 0 };
    
    for (const user of allUsers) {
      try {
        const devices = await dataProvider.listUserMfaDevices(user.poolId, user.id);
        totalDevices += devices.length;
        
        for (const device of devices) {
          if (device.isVerified) {
            verifiedDevices++;
          }
          devicesByType[device.deviceType] = (devicesByType[device.deviceType] || 0) + 1;
        }
      } catch (error) {
        logger.warn(`Failed to get devices for user ${user.id}:`, error);
      }
    }
    
    return {
      totalDevices,
      verifiedDevices,
      devicesByType
    };
  } catch (error) {
    logger.error('Error getting MFA device stats:', error);
    return {
      totalDevices: 0,
      verifiedDevices: 0,
      devicesByType: { TOTP: 0, SMS: 0 }
    };
  }
}

function generateMockAuditLogs(): any[] {
  const events = [
    { type: 'MFA_DEVICE_SETUP', description: 'User set up MFA device' },
    { type: 'MFA_VERIFICATION_SUCCESS', description: 'MFA verification successful' },
    { type: 'MFA_VERIFICATION_FAILED', description: 'MFA verification failed' },
    { type: 'MFA_DEVICE_REMOVED', description: 'MFA device removed' },
    { type: 'MFA_ADMIN_RESET', description: 'Admin reset user MFA' },
    { type: 'MFA_ADMIN_DISABLE', description: 'Admin disabled user MFA' }
  ];
  
  const users = ['user1@example.com', 'user2@company.org', 'admin@localhost'];
  const logs = [];
  
  for (let i = 0; i < 500; i++) {
    const event = events[Math.floor(Math.random() * events.length)];
    const user = users[Math.floor(Math.random() * users.length)];
    
    logs.push({
      id: `log-${i}`,
      timestamp: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
      eventType: event.type,
      description: event.description,
      userId: `user-${Math.floor(Math.random() * 1000)}`,
      userEmail: user,
      poolId: 'default-pool',
      ipAddress: `192.168.1.${Math.floor(Math.random() * 255)}`,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      success: Math.random() > 0.15,
      metadata: {
        deviceType: 'TOTP',
        deviceName: 'Mobile Phone'
      }
    });
  }
  
  return logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

function convertLogsToCSV(logs: any[]): string {
  const headers = ['Timestamp', 'Event Type', 'User Email', 'Pool ID', 'IP Address', 'Success', 'Description'];
  const csvRows = [headers.join(',')];
  
  logs.forEach(log => {
    const row = [
      log.timestamp.toISOString(),
      log.eventType,
      log.userEmail,
      log.poolId,
      log.ipAddress,
      log.success,
      `"${log.description}"`
    ];
    csvRows.push(row.join(','));
  });
  
  return csvRows.join('\n');
}

export { router as adminMfaRoutes };
