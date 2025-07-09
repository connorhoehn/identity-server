import * as authenticator from 'authenticator';
import { randomBytes } from 'crypto';
import qrcode from 'qrcode';
import { getDataProvider } from '../providers/data-provider-factory.js';
import { MfaDeviceData } from '../interfaces/data-provider.js';
import { logger } from '../utils/logger.js';

export interface MfaSetupData {
  secret: string;
  qrCodeDataURL: string;
  backupCodes: string[];
  deviceId: string;
}

export interface VerifyTotpResult {
  valid: boolean;
  deviceId?: string;
}

export class MfaService {
  private static readonly APP_NAME = process.env.APP_NAME || 'Identity Server';
  private static readonly ISSUER = process.env.ISSUER_URL || 'localhost:3005';

  /**
   * Generate a new TOTP secret and QR code for device registration
   */
  static async generateTotpSetup(
    poolId: string, 
    userId: string, 
    userEmail: string, 
    deviceName: string = 'Default Device'
  ): Promise<MfaSetupData> {
    try {
      // Generate a random secret
      const secret = authenticator.generateKey();
      
      // Generate backup codes
      const backupCodes = this.generateBackupCodes();
      
      // Create device record (unverified initially)
      const dataProvider = getDataProvider();
      const device = await dataProvider.createMfaDevice({
        poolId,
        userId,
        deviceName,
        deviceType: 'TOTP',
        secretKey: secret,
        isVerified: false,
        backupCodes
      });

      // Generate QR code for the secret
      const otpauth = authenticator.generateTotpUri(
        secret,
        userEmail,
        this.APP_NAME,
        'SHA1',
        6,
        30
      );

      const qrCodeDataURL = await qrcode.toDataURL(otpauth);

      logger.info('TOTP setup generated', {
        deviceId: device.deviceId,
        userId,
        deviceName,
        hasSecret: !!secret,
        hasQrCode: !!qrCodeDataURL
      });

      return {
        secret,
        qrCodeDataURL,
        backupCodes,
        deviceId: device.deviceId
      };
    } catch (error) {
      logger.error('Error generating TOTP setup:', error);
      throw new Error('Failed to generate MFA setup');
    }
  }

  /**
   * Verify a TOTP code for device registration
   */
  static async verifyTotpForRegistration(
    poolId: string,
    userId: string,
    deviceId: string,
    totpCode: string
  ): Promise<boolean> {
    try {
      const dataProvider = getDataProvider();
      const device = await dataProvider.getMfaDevice(poolId, userId, deviceId);

      if (!device) {
        logger.warn('Device not found for TOTP verification', { poolId, userId, deviceId });
        return false;
      }

      if (device.isVerified) {
        logger.warn('Device already verified', { deviceId });
        return false;
      }

      // Verify the TOTP code
      const isValid = authenticator.verifyToken(device.secretKey, totpCode);
      const isValidBoolean = !!isValid;

      if (isValidBoolean) {
        // Mark device as verified
        await dataProvider.verifyMfaDevice(poolId, userId, deviceId);
        
        // Enable MFA for the user
        await dataProvider.updateUser(poolId, userId, { mfaEnabled: true });

        logger.info('TOTP verification successful - device verified', {
          deviceId,
          userId,
          deviceName: device.deviceName
        });
      } else {
        logger.warn('TOTP verification failed', { deviceId, userId });
      }

      return isValidBoolean;
    } catch (error) {
      logger.error('Error verifying TOTP for registration:', error);
      return false;
    }
  }

  /**
   * Verify a TOTP code for authentication
   */
  static async verifyTotpForAuthentication(
    poolId: string,
    userId: string,
    totpCode: string
  ): Promise<VerifyTotpResult> {
    try {
      const dataProvider = getDataProvider();
      const devices = await dataProvider.listUserMfaDevices(poolId, userId);
      
      const verifiedDevices = devices.filter(device => device.isVerified);
      
      if (verifiedDevices.length === 0) {
        logger.warn('No verified MFA devices found for user', { poolId, userId });
        return { valid: false };
      }

      // Try to verify against each device
      for (const device of verifiedDevices) {
        const isValid = authenticator.verifyToken(device.secretKey, totpCode);
        
        if (isValid) {
          // Update last used timestamp
          await dataProvider.updateMfaDevice(poolId, userId, device.deviceId, {
            lastUsed: new Date()
          });

          logger.info('TOTP authentication successful', {
            deviceId: device.deviceId,
            userId,
            deviceName: device.deviceName
          });

          return { valid: true, deviceId: device.deviceId };
        }
      }

      logger.warn('TOTP authentication failed for all devices', { poolId, userId });
      return { valid: false };
    } catch (error) {
      logger.error('Error verifying TOTP for authentication:', error);
      return { valid: false };
    }
  }

  /**
   * Verify a backup code for authentication
   */
  static async verifyBackupCode(
    poolId: string,
    userId: string,
    backupCode: string
  ): Promise<{ valid: boolean; deviceId?: string }> {
    try {
      const dataProvider = getDataProvider();
      const devices = await dataProvider.listUserMfaDevices(poolId, userId);
      
      const verifiedDevices = devices.filter(device => device.isVerified);
      
      if (verifiedDevices.length === 0) {
        logger.warn('No verified MFA devices found for user', { poolId, userId });
        return { valid: false };
      }

      // Try to verify against each device's backup codes
      for (const device of verifiedDevices) {
        if (device.backupCodes && device.backupCodes.includes(backupCode)) {
          // Remove the used backup code
          const remainingCodes = device.backupCodes.filter(code => code !== backupCode);
          
          // Update device with remaining backup codes
          await dataProvider.updateMfaDevice(poolId, userId, device.deviceId, {
            backupCodes: remainingCodes,
            lastUsed: new Date()
          });

          logger.info('Backup code authentication successful', {
            deviceId: device.deviceId,
            userId,
            deviceName: device.deviceName,
            remainingBackupCodes: remainingCodes.length
          });

          return { valid: true, deviceId: device.deviceId };
        }
      }

      logger.warn('Backup code authentication failed for all devices', { poolId, userId });
      return { valid: false };
    } catch (error) {
      logger.error('Error verifying backup code for authentication:', error);
      return { valid: false };
    }
  }

  /**
   * Generate backup codes for account recovery
   */
  private static generateBackupCodes(count: number = 8): string[] {
    const codes: string[] = [];
    
    for (let i = 0; i < count; i++) {
      // Generate 8-digit backup code
      const code = randomBytes(4).toString('hex').toUpperCase();
      codes.push(code);
    }
    
    return codes;
  }

  /**
   * Get user's MFA devices
   */
  static async getUserMfaDevices(poolId: string, userId: string): Promise<MfaDeviceData[]> {
    try {
      const dataProvider = getDataProvider();
      return await dataProvider.listUserMfaDevices(poolId, userId);
    } catch (error) {
      logger.error('Error getting user MFA devices:', error);
      return [];
    }
  }

  /**
   * Remove an MFA device
   */
  static async removeMfaDevice(poolId: string, userId: string, deviceId: string): Promise<boolean> {
    try {
      const dataProvider = getDataProvider();
      await dataProvider.deleteMfaDevice(poolId, userId, deviceId);
      
      // Check if user has any remaining verified devices
      const remainingDevices = await dataProvider.listUserMfaDevices(poolId, userId);
      const hasVerifiedDevices = remainingDevices.some(device => device.isVerified);
      
      // If no verified devices remain, disable MFA for the user
      if (!hasVerifiedDevices) {
        await dataProvider.updateUser(poolId, userId, { mfaEnabled: false });
        logger.info('MFA disabled for user - no verified devices remaining', { userId });
      }

      logger.info('MFA device removed', { deviceId, userId });
      return true;
    } catch (error) {
      logger.error('Error removing MFA device:', error);
      return false;
    }
  }

  /**
   * Check if user has MFA enabled
   */
  static async isUserMfaEnabled(poolId: string, userId: string): Promise<boolean> {
    try {
      const dataProvider = getDataProvider();
      const user = await dataProvider.getUser(poolId, userId);
      return user?.mfaEnabled || false;
    } catch (error) {
      logger.error('Error checking user MFA status:', error);
      return false;
    }
  }

  /**
   * For development/testing: log TOTP code instead of sending via notification service
   */
  static logTotpCode(secret: string, label: string = 'Current TOTP'): void {
    const currentCode = authenticator.generateToken(secret);
    const timeRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
    
    logger.info(`🔐 ${label}: ${currentCode} (expires in ${timeRemaining}s)`, {
      code: currentCode,
      timeRemaining,
      timestamp: new Date().toISOString()
    });
  }
}
