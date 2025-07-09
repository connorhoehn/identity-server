import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { getDataProvider } from '../providers/data-provider-factory.js';
import { UserData } from '../interfaces/data-provider.js';
import { logger } from '../utils/logger.js';

interface CreateUserData {
  email: string;
  password: string;
  given_name?: string;
  family_name?: string;
  nickname?: string;
  picture?: string;
  website?: string;
  customAttributes?: Record<string, any>;
}

interface UpdateUserData {
  email?: string;
  password?: string;
  given_name?: string;
  family_name?: string;
  nickname?: string;
  picture?: string;
  website?: string;
  customAttributes?: Record<string, any>;
  groups?: string[];
  status?: 'CONFIRMED' | 'UNCONFIRMED' | 'ARCHIVED' | 'COMPROMISED' | 'RESET_REQUIRED';
  mfaEnabled?: boolean;
}

export class Account {
  public accountId: string;
  public profile: any;
  public poolId: string;

  constructor(id: string, profile: any, poolId: string) {
    this.accountId = id;
    this.profile = profile;
    this.poolId = poolId;
  }

  static async findAccount(ctx: any, id: string, token?: any): Promise<Account | undefined> {
    try {
      logger.info('=== findAccount called ===', { 
        id, 
        idType: typeof id,
        clientId: ctx.oidc?.client?.clientId, 
        hasToken: !!token,
        contextKeys: Object.keys(ctx).filter(k => !k.startsWith('_')),
        oidcKeys: ctx.oidc ? Object.keys(ctx.oidc).filter(k => !k.startsWith('_')) : [],
        interactionUid: ctx.oidc?.uid,
        sessionAccountId: ctx.oidc?.session?.accountId,
        promptName: ctx.oidc?.prompt?.name,
        promptReasons: ctx.oidc?.prompt?.reasons
      });
      
      // Check if id is a UUID (legacy format) - if so, return undefined to force re-authentication
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (isUUID) {
        logger.warn('Legacy UUID account ID detected, forcing re-authentication:', id);
        return undefined;
      }

      // Get client context to determine pool
      const clientId = ctx.oidc?.client?.clientId;
      if (!clientId) {
        logger.error('No client ID found in context for findAccount', { 
          hasOidc: !!ctx.oidc,
          hasClient: !!(ctx.oidc && ctx.oidc.client),
          oidcClient: ctx.oidc?.client
        });
        return undefined;
      }

      const dataProvider = getDataProvider();
      const userPool = await dataProvider.getUserPoolByClientId(clientId);
      
      if (!userPool) {
        logger.error('No user pool found for client in findAccount:', clientId);
        return undefined;
      }

      // Convert string ID to number if needed, then back to string for consistency
      const userId = isNaN(Number(id)) ? id : String(Number(id));
      
      logger.info('Looking up user in findAccount', { userId, originalId: id, poolId: userPool.poolId });
      const user = await dataProvider.getUser(userPool.poolId, userId);
      if (!user) {
        logger.warn('User not found in findAccount', { userId, originalId: id, poolId: userPool.poolId });
        return undefined;
      }

      logger.info('User found in findAccount - creating Account object', { userId: user.userId, email: user.email });
      const account = new Account(String(user.userId), {
        sub: String(user.userId), // Ensure sub is also a string
        email: user.email,
        email_verified: user.emailVerified,
        given_name: user.givenName,
        family_name: user.familyName,
        name: user.name || `${user.givenName || ''} ${user.familyName || ''}`.trim(),
        nickname: user.nickname,
        picture: user.picture,
        website: user.website,
        ...user.customAttributes,
        updated_at: Math.floor(user.updatedAt.getTime() / 1000),
      }, userPool.poolId);
      
      logger.info('=== findAccount successful ===', { 
        accountId: account.accountId, 
        email: account.profile.email,
        poolId: account.poolId,
        sub: account.profile.sub
      });
      
      return account;
    } catch (error) {
      logger.error('=== findAccount error ===', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        id,
        clientId: ctx.oidc?.client?.clientId
      });
      return undefined;
    }
  }

  static async findByEmail(email: string, poolId: string): Promise<Account | undefined> {
    try {
      const dataProvider = getDataProvider();
      const user = await dataProvider.getUserByEmail(poolId, email);
      
      if (!user) {
        return undefined;
      }

      return new Account(user.userId, {
        sub: user.userId,
        email: user.email,
        email_verified: user.emailVerified,
        given_name: user.givenName,
        family_name: user.familyName,
        name: user.name || `${user.givenName || ''} ${user.familyName || ''}`.trim(),
        nickname: user.nickname,
        picture: user.picture,
        website: user.website,
        ...user.customAttributes,
        password_hash: user.passwordHash,
      }, poolId);
    } catch (error) {
      logger.error('Error finding account by email:', error);
      return undefined;
    }
  }

  static async authenticate(email: string, password: string, clientId: string): Promise<Account | null> {
    try {
      logger.info('Starting authentication', { email, clientId, hasPassword: !!password });
      
      const dataProvider = getDataProvider();
      const userPool = await dataProvider.getUserPoolByClientId(clientId);
      
      if (!userPool) {
        logger.error('No user pool found for client:', clientId);
        return null;
      }

      logger.info('User pool found', { poolId: userPool.poolId, poolName: userPool.poolName });

      const account = await Account.findByEmail(email, userPool.poolId);
      if (!account) {
        logger.warn('No account found for email in pool', { email, poolId: userPool.poolId });
        return null;
      }

      logger.info('Account found', { accountId: account.accountId, hasPasswordHash: !!account.profile.password_hash });

      if (!account.profile.password_hash) {
        logger.error('Account has no password hash', { accountId: account.accountId });
        return null;
      }

      const isValid = await bcrypt.compare(password, account.profile.password_hash);
      logger.info('Password comparison result', { isValid, email });
      
      if (!isValid) {
        logger.warn('Invalid password for user', { email });
        return null;
      }

      // Update last login
      await dataProvider.updateUser(userPool.poolId, account.accountId, {
        lastLogin: new Date(),
      });

      logger.info('Authentication successful', { email, accountId: account.accountId });

      // Remove password hash from profile for security
      delete account.profile.password_hash;
      return account;
    } catch (error) {
      logger.error('Error authenticating account:', error);
      return null;
    }
  }

  static async create(userData: CreateUserData, poolId: string): Promise<Account> {
    try {
      const dataProvider = getDataProvider();
      const passwordHash = await bcrypt.hash(userData.password, 10);

      const user = await dataProvider.createUser({
        poolId,
        email: userData.email,
        emailVerified: false,
        passwordHash,
        name: userData.given_name && userData.family_name ? 
          `${userData.given_name} ${userData.family_name}` : undefined,
        givenName: userData.given_name,
        familyName: userData.family_name,
        nickname: userData.nickname,
        picture: userData.picture,
        website: userData.website,
        customAttributes: userData.customAttributes || {},
        groups: [],
        status: 'CONFIRMED',
        mfaEnabled: false,
      });

      return new Account(user.userId, {
        sub: user.userId,
        email: user.email,
        email_verified: user.emailVerified,
        given_name: user.givenName,
        family_name: user.familyName,
        name: user.name,
        nickname: user.nickname,
        picture: user.picture,
        website: user.website,
        ...user.customAttributes,
      }, poolId);
    } catch (error) {
      logger.error('Error creating account:', error);
      throw new Error('Failed to create account');
    }
  }

  static async findAll(poolId: string): Promise<Account[]> {
    try {
      const dataProvider = getDataProvider();
      const result = await dataProvider.listUsers(poolId);
      
      return result.users.map(user => {
        const account = new Account(user.userId, {
          sub: user.userId,
          email: user.email,
          email_verified: user.emailVerified,
          given_name: user.givenName,
          family_name: user.familyName,
          name: user.name || `${user.givenName || ''} ${user.familyName || ''}`.trim(),
          nickname: user.nickname,
          picture: user.picture,
          website: user.website,
          ...user.customAttributes,
          created_at: user.createdAt,
          updated_at: user.updatedAt,
        }, poolId);
        
        // Add raw user data for admin interface
        (account as any).id = user.userId;
        (account as any).email = user.email;
        (account as any).created_at = user.createdAt;
        (account as any).updated_at = user.updatedAt;
        (account as any).is_active = user.status === 'CONFIRMED';
        (account as any).status = user.status;
        (account as any).mfaEnabled = user.mfaEnabled;
        (account as any).groups = user.groups;
        
        return account;
      });
    } catch (error) {
      logger.error('Error finding all accounts:', error);
      return [];
    }
  }

  static async update(id: string, userData: UpdateUserData, poolId: string): Promise<Account> {
    try {
      const dataProvider = getDataProvider();
      
      // Build update object
      const updateData: Partial<UserData> = {};

      if (userData.email !== undefined) {
        updateData.email = userData.email;
      }

      if (userData.password) {
        updateData.passwordHash = await bcrypt.hash(userData.password, 10);
      }

      if (userData.given_name !== undefined) {
        updateData.givenName = userData.given_name;
      }

      if (userData.family_name !== undefined) {
        updateData.familyName = userData.family_name;
      }

      if (userData.nickname !== undefined) {
        updateData.nickname = userData.nickname;
      }

      if (userData.picture !== undefined) {
        updateData.picture = userData.picture;
      }

      if (userData.website !== undefined) {
        updateData.website = userData.website;
      }

      if (userData.customAttributes !== undefined) {
        updateData.customAttributes = userData.customAttributes;
      }

      if (userData.groups !== undefined) {
        updateData.groups = userData.groups;
      }

      if (userData.status !== undefined) {
        updateData.status = userData.status;
      }

      if (userData.mfaEnabled !== undefined) {
        updateData.mfaEnabled = userData.mfaEnabled;
      }

      // Update name if given_name or family_name changed
      if (userData.given_name !== undefined || userData.family_name !== undefined) {
        const currentUser = await dataProvider.getUser(poolId, id);
        if (currentUser) {
          const givenName = userData.given_name !== undefined ? userData.given_name : currentUser.givenName;
          const familyName = userData.family_name !== undefined ? userData.family_name : currentUser.familyName;
          updateData.name = givenName && familyName ? `${givenName} ${familyName}` : undefined;
        }
      }

      const user = await dataProvider.updateUser(poolId, id, updateData);

      return new Account(user.userId, {
        sub: user.userId,
        email: user.email,
        email_verified: user.emailVerified,
        given_name: user.givenName,
        family_name: user.familyName,
        name: user.name,
        nickname: user.nickname,
        picture: user.picture,
        website: user.website,
        ...user.customAttributes,
      }, poolId);
    } catch (error) {
      logger.error('Error updating account:', error);
      throw error;
    }
  }

  static async delete(id: string, poolId: string): Promise<void> {
    try {
      const dataProvider = getDataProvider();
      await dataProvider.deleteUser(poolId, id);
      logger.info('User deleted successfully:', { id, poolId });
    } catch (error) {
      logger.error('Error deleting account:', error);
      throw error;
    }
  }

  async claims(use: string, scope: string, claims: any, rejected: string[]): Promise<any> {
    const profile: any = { sub: this.accountId };

    if (scope.includes('openid')) {
      profile.sub = this.accountId;
    }

    if (scope.includes('profile')) {
      Object.assign(profile, {
        given_name: this.profile.given_name,
        family_name: this.profile.family_name,
        name: this.profile.name,
        nickname: this.profile.nickname,
        picture: this.profile.picture,
        website: this.profile.website,
        updated_at: this.profile.updated_at,
      });
    }

    if (scope.includes('email')) {
      Object.assign(profile, {
        email: this.profile.email,
        email_verified: this.profile.email_verified,
      });
    }

    // Add custom attributes from the user pool
    const dataProvider = getDataProvider();
    const userPool = await dataProvider.getUserPool(this.poolId);
    
    if (userPool && userPool.customAttributes) {
      for (const [attrName, attrType] of Object.entries(userPool.customAttributes)) {
        if (this.profile[attrName] !== undefined) {
          profile[attrName] = this.profile[attrName];
        }
      }
    }

    return profile;
  }

  // Static method to get the default pool ID (for backward compatibility)
  static async getDefaultPoolId(): Promise<string> {
    const dataProvider = getDataProvider();
    const pools = await dataProvider.listUserPools();
    
    // Return the first pool or create a default one
    if (pools.length > 0) {
      return pools[0].poolId;
    }

    // Create default pool if none exists
    const defaultPool = await dataProvider.createUserPool({
      poolId: 'default-pool',
      clientId: process.env.CLIENT_ID || 'local-test-client',
      poolName: 'Default Pool',
      customAttributes: {},
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

    return defaultPool.poolId;
  }

  // Helper method to get pool ID by client ID
  static async getPoolIdByClientId(clientId: string): Promise<string | null> {
    try {
      const dataProvider = getDataProvider();
      const userPool = await dataProvider.getUserPoolByClientId(clientId);
      return userPool ? userPool.poolId : null;
    } catch (error) {
      logger.error('Error getting pool ID by client ID:', error);
      return null;
    }
  }
}
