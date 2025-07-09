import { Router, Request, Response } from 'express';
import { MfaService } from '../services/mfa-service.js';
import { getDataProvider } from '../providers/data-provider-factory.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * Initiate MFA device setup
 * POST /api/mfa/setup
 */
router.post('/setup', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, poolId, deviceName } = req.body;
    
    if (!userId || !poolId) {
      res.status(400).json({ error: 'userId and poolId are required' });
      return;
    }

    // Get user details
    const dataProvider = getDataProvider();
    const user = await dataProvider.getUser(poolId, userId);
    
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Generate TOTP setup
    const setupData = await MfaService.generateTotpSetup(
      poolId,
      userId,
      user.email,
      deviceName || 'Default Device'
    );

    // For development: log the current TOTP code
    MfaService.logTotpCode(setupData.secret, 'Setup TOTP Code');

    res.json({
      success: true,
      deviceId: setupData.deviceId,
      qrCode: setupData.qrCodeDataURL,
      secret: setupData.secret,
      backupCodes: setupData.backupCodes,
      message: 'Scan the QR code with your authenticator app and enter the 6-digit code to verify'
    });

  } catch (error) {
    logger.error('MFA setup error:', error);
    res.status(500).json({ 
      error: 'Failed to setup MFA device',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Verify TOTP code to complete device registration
 * POST /api/mfa/verify-setup
 */
router.post('/verify-setup', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, poolId, deviceId, totpCode } = req.body;
    
    if (!userId || !poolId || !deviceId || !totpCode) {
      res.status(400).json({ 
        error: 'userId, poolId, deviceId, and totpCode are required' 
      });
      return;
    }

    // Verify the TOTP code
    const isValid = await MfaService.verifyTotpForRegistration(
      poolId,
      userId,
      deviceId,
      totpCode
    );

    if (isValid) {
      res.json({
        success: true,
        message: 'MFA device verified and enabled successfully'
      });
    } else {
      res.status(400).json({
        error: 'Invalid TOTP code',
        message: 'Please check your authenticator app and try again'
      });
    }

  } catch (error) {
    logger.error('MFA verification error:', error);
    res.status(500).json({ 
      error: 'Failed to verify MFA device',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get user's MFA devices
 * GET /api/mfa/devices/:poolId/:userId
 */
router.get('/devices/:poolId/:userId', async (req: Request, res: Response) => {
  try {
    const { poolId, userId } = req.params;
    
    const devices = await MfaService.getUserMfaDevices(poolId, userId);
    
    // Remove sensitive data before sending to client
    const safeDevices = devices.map(device => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      deviceType: device.deviceType,
      isVerified: device.isVerified,
      createdAt: device.createdAt,
      lastUsed: device.lastUsed
    }));

    res.json({
      success: true,
      devices: safeDevices
    });

  } catch (error) {
    logger.error('Error getting MFA devices:', error);
    res.status(500).json({ 
      error: 'Failed to get MFA devices',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Remove MFA device
 * DELETE /api/mfa/device/:poolId/:userId/:deviceId
 */
router.delete('/device/:poolId/:userId/:deviceId', async (req: Request, res: Response) => {
  try {
    const { poolId, userId, deviceId } = req.params;
    
    const success = await MfaService.removeMfaDevice(poolId, userId, deviceId);
    
    if (success) {
      res.json({
        success: true,
        message: 'MFA device removed successfully'
      });
    } else {
      res.status(404).json({
        error: 'MFA device not found'
      });
    }

  } catch (error) {
    logger.error('Error removing MFA device:', error);
    res.status(500).json({ 
      error: 'Failed to remove MFA device',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Verify TOTP for authentication
 * POST /api/mfa/verify-auth
 */
router.post('/verify-auth', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, poolId, totpCode } = req.body;
    
    if (!userId || !poolId || !totpCode) {
      res.status(400).json({ 
        error: 'userId, poolId, and totpCode are required' 
      });
      return;
    }

    const result = await MfaService.verifyTotpForAuthentication(poolId, userId, totpCode);
    
    if (result.valid) {
      res.json({
        success: true,
        deviceId: result.deviceId,
        message: 'TOTP verification successful'
      });
    } else {
      res.status(400).json({
        error: 'Invalid TOTP code',
        message: 'Please check your authenticator app and try again'
      });
    }

  } catch (error) {
    logger.error('MFA authentication error:', error);
    res.status(500).json({ 
      error: 'Failed to verify TOTP',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Check if user has MFA enabled
 * GET /api/mfa/status/:poolId/:userId
 */
router.get('/status/:poolId/:userId', async (req: Request, res: Response) => {
  try {
    const { poolId, userId } = req.params;
    
    const mfaEnabled = await MfaService.isUserMfaEnabled(poolId, userId);
    const devices = await MfaService.getUserMfaDevices(poolId, userId);
    
    res.json({
      success: true,
      mfaEnabled,
      deviceCount: devices.length,
      verifiedDeviceCount: devices.filter(d => d.isVerified).length
    });

  } catch (error) {
    logger.error('Error checking MFA status:', error);
    res.status(500).json({ 
      error: 'Failed to check MFA status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Rename MFA device
 * PUT /api/mfa/device/:poolId/:userId/:deviceId/rename
 */
router.put('/device/:poolId/:userId/:deviceId/rename', async (req: Request, res: Response): Promise<void> => {
  try {
    const { poolId, userId, deviceId } = req.params;
    const { deviceName } = req.body;

    if (!deviceName || deviceName.trim().length === 0) {
      res.status(400).json({ error: 'Device name is required' });
      return;
    }

    if (deviceName.length > 50) {
      res.status(400).json({ error: 'Device name must be 50 characters or less' });
      return;
    }

    const dataProvider = getDataProvider();
    
    // Check if device exists
    const device = await dataProvider.getMfaDevice(poolId, userId, deviceId);
    if (!device) {
      res.status(404).json({ error: 'MFA device not found' });
      return;
    }

    // Update device name
    await dataProvider.updateMfaDevice(poolId, userId, deviceId, {
      deviceName: deviceName.trim()
    });

    logger.info('MFA device renamed', {
      poolId,
      userId,
      deviceId,
      oldName: device.deviceName,
      newName: deviceName.trim()
    });

    res.json({
      success: true,
      message: 'Device renamed successfully'
    });

  } catch (error) {
    logger.error('Error renaming MFA device:', error);
    res.status(500).json({ 
      error: 'Failed to rename device',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as mfaRoutes };
