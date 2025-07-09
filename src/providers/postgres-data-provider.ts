import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { 
  IDataProvider, 
  UserPoolData, 
  UserData, 
  ClientData, 
  GroupData,
  MfaDeviceData 
} from '../interfaces/data-provider.js';
import { logger } from '../utils/logger.js';

export class PostgreSQLDataProvider implements IDataProvider {
  private pool: Pool;
  private isConnected = false;

  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'identity_server',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      await this.createTables();
      this.isConnected = true;
      logger.info('PostgreSQL data provider connected');
    } catch (error) {
      logger.error('Failed to connect PostgreSQL data provider:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this.pool.end();
      this.isConnected = false;
      logger.info('PostgreSQL data provider disconnected');
    } catch (error) {
      logger.error('Failed to disconnect PostgreSQL data provider:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // User pools table
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_pools (
          pool_id VARCHAR(255) PRIMARY KEY,
          client_id VARCHAR(255) UNIQUE NOT NULL,
          pool_name VARCHAR(255) NOT NULL,
          custom_attributes JSONB DEFAULT '{}',
          settings JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Users table (updated for multi-tenant)
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          pool_id VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL,
          email_verified BOOLEAN DEFAULT FALSE,
          password_hash VARCHAR(255) NOT NULL,
          name VARCHAR(255),
          given_name VARCHAR(255),
          family_name VARCHAR(255),
          nickname VARCHAR(255),
          picture TEXT,
          website TEXT,
          custom_attributes JSONB DEFAULT '{}',
          groups TEXT[] DEFAULT '{}',
          status VARCHAR(50) DEFAULT 'CONFIRMED',
          mfa_enabled BOOLEAN DEFAULT FALSE,
          last_login TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (pool_id) REFERENCES user_pools(pool_id) ON DELETE CASCADE,
          UNIQUE(pool_id, email)
        );
      `);

      // Clients table (updated for multi-tenant)
      await client.query(`
        CREATE TABLE IF NOT EXISTS clients (
          client_id VARCHAR(255) PRIMARY KEY,
          client_secret VARCHAR(255) NOT NULL,
          client_name VARCHAR(255) NOT NULL,
          pool_id VARCHAR(255) NOT NULL,
          redirect_uris TEXT[] NOT NULL DEFAULT '{}',
          post_logout_redirect_uris TEXT[] DEFAULT '{}',
          response_types TEXT[] NOT NULL DEFAULT '{"code"}',
          grant_types TEXT[] NOT NULL DEFAULT '{"authorization_code", "refresh_token"}',
          scope VARCHAR(255) NOT NULL DEFAULT 'openid profile email',
          token_endpoint_auth_method VARCHAR(50) NOT NULL DEFAULT 'client_secret_basic',
          application_type VARCHAR(50) DEFAULT 'web',
          settings JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (pool_id) REFERENCES user_pools(pool_id) ON DELETE CASCADE
        );
      `);

      // Groups table
      await client.query(`
        CREATE TABLE IF NOT EXISTS groups (
          group_id VARCHAR(255) PRIMARY KEY,
          pool_id VARCHAR(255) NOT NULL,
          group_name VARCHAR(255) NOT NULL,
          description TEXT,
          permissions TEXT[] DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (pool_id) REFERENCES user_pools(pool_id) ON DELETE CASCADE,
          UNIQUE(pool_id, group_name)
        );
      `);

      // MFA devices table
      await client.query(`
        CREATE TABLE IF NOT EXISTS mfa_devices (
          device_id VARCHAR(255) PRIMARY KEY,
          pool_id VARCHAR(255) NOT NULL,
          user_id INTEGER NOT NULL,
          device_name VARCHAR(255) NOT NULL,
          device_type VARCHAR(50) NOT NULL DEFAULT 'TOTP',
          secret_key VARCHAR(255) NOT NULL,
          is_verified BOOLEAN DEFAULT FALSE,
          backup_codes TEXT[],
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          last_used TIMESTAMP WITH TIME ZONE,
          FOREIGN KEY (pool_id) REFERENCES user_pools(pool_id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(pool_id, user_id, device_name)
        );
      `);

      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_users_pool_id ON users(pool_id);
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(pool_id, email);
        CREATE INDEX IF NOT EXISTS idx_clients_pool_id ON clients(pool_id);
        CREATE INDEX IF NOT EXISTS idx_groups_pool_id ON groups(pool_id);
        CREATE INDEX IF NOT EXISTS idx_user_pools_client_id ON user_pools(client_id);
        CREATE INDEX IF NOT EXISTS idx_mfa_devices_user ON mfa_devices(pool_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_mfa_devices_pool ON mfa_devices(pool_id);
      `);

      // Create update timestamp trigger function
      await client.query(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
        END;
        $$ language 'plpgsql';
      `);

      // Create triggers for updated_at
      const tables = ['user_pools', 'users', 'clients', 'groups', 'mfa_devices'];
      for (const table of tables) {
        await client.query(`
          DROP TRIGGER IF EXISTS update_${table}_updated_at ON ${table};
          CREATE TRIGGER update_${table}_updated_at
            BEFORE UPDATE ON ${table}
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        `);
      }

      logger.info('PostgreSQL tables created/verified successfully');
    } finally {
      client.release();
    }
  }

  // User Pool operations
  async createUserPool(pool: Omit<UserPoolData, 'createdAt' | 'updatedAt'>): Promise<UserPoolData> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO user_pools (pool_id, client_id, pool_name, custom_attributes, settings)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          pool.poolId,
          pool.clientId,
          pool.poolName,
          JSON.stringify(pool.customAttributes),
          JSON.stringify(pool.settings),
        ]
      );

      return this.mapUserPoolRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async getUserPool(poolId: string): Promise<UserPoolData | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM user_pools WHERE pool_id = $1',
        [poolId]
      );

      return result.rows.length > 0 ? this.mapUserPoolRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async getUserPoolByClientId(clientId: string): Promise<UserPoolData | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM user_pools WHERE client_id = $1',
        [clientId]
      );

      return result.rows.length > 0 ? this.mapUserPoolRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async listUserPools(): Promise<UserPoolData[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT * FROM user_pools ORDER BY created_at DESC');
      return result.rows.map(row => this.mapUserPoolRow(row));
    } finally {
      client.release();
    }
  }

  async updateUserPool(poolId: string, updates: Partial<UserPoolData>): Promise<UserPoolData> {
    const client = await this.pool.connect();
    try {
      const setParts: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.poolName !== undefined) {
        setParts.push(`pool_name = $${paramIndex++}`);
        values.push(updates.poolName);
      }
      if (updates.customAttributes !== undefined) {
        setParts.push(`custom_attributes = $${paramIndex++}`);
        values.push(JSON.stringify(updates.customAttributes));
      }
      if (updates.settings !== undefined) {
        setParts.push(`settings = $${paramIndex++}`);
        values.push(JSON.stringify(updates.settings));
      }

      values.push(poolId);

      const result = await client.query(
        `UPDATE user_pools SET ${setParts.join(', ')} WHERE pool_id = $${paramIndex} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw new Error(`User pool not found: ${poolId}`);
      }

      return this.mapUserPoolRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async deleteUserPool(poolId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('DELETE FROM user_pools WHERE pool_id = $1', [poolId]);
      if (result.rowCount === 0) {
        throw new Error(`User pool not found: ${poolId}`);
      }
    } finally {
      client.release();
    }
  }

  // User operations
  async createUser(user: Omit<UserData, 'userId' | 'createdAt' | 'updatedAt'>): Promise<UserData> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO users (
          pool_id, email, email_verified, password_hash, name, given_name, 
          family_name, nickname, picture, website, custom_attributes, groups, 
          status, mfa_enabled
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`,
        [
          user.poolId,
          user.email,
          user.emailVerified,
          user.passwordHash,
          user.name,
          user.givenName,
          user.familyName,
          user.nickname,
          user.picture,
          user.website,
          JSON.stringify(user.customAttributes),
          user.groups,
          user.status,
          user.mfaEnabled,
        ]
      );

      return this.mapUserRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async getUser(poolId: string, userId: string): Promise<UserData | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM users WHERE pool_id = $1 AND id = $2',
        [poolId, userId]
      );

      return result.rows.length > 0 ? this.mapUserRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async getUserByEmail(poolId: string, email: string): Promise<UserData | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM users WHERE pool_id = $1 AND email = $2',
        [poolId, email]
      );

      return result.rows.length > 0 ? this.mapUserRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async listUsers(poolId: string, limit = 50, nextToken?: string): Promise<{ users: UserData[], nextToken?: string }> {
    const client = await this.pool.connect();
    try {
      let query = 'SELECT * FROM users WHERE pool_id = $1';
      const values = [poolId];

      if (nextToken) {
        query += ' AND id > $2';
        values.push(nextToken);
      }

      query += ' ORDER BY id LIMIT $' + (values.length + 1);
      values.push(limit.toString());

      const result = await client.query(query, values);
      const users = result.rows.map(row => this.mapUserRow(row));

      const newNextToken = users.length === limit ? users[users.length - 1].userId : undefined;

      return { users, nextToken: newNextToken };
    } finally {
      client.release();
    }
  }

  async updateUser(poolId: string, userId: string, updates: Partial<UserData>): Promise<UserData> {
    const client = await this.pool.connect();
    try {
      const setParts: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      const updateableFields = [
        'email', 'emailVerified', 'passwordHash', 'name', 'givenName', 
        'familyName', 'nickname', 'picture', 'website', 'customAttributes',
        'groups', 'status', 'mfaEnabled', 'lastLogin'
      ];

      for (const field of updateableFields) {
        if (updates[field as keyof UserData] !== undefined) {
          const dbField = field === 'emailVerified' ? 'email_verified' :
                          field === 'passwordHash' ? 'password_hash' :
                          field === 'givenName' ? 'given_name' :
                          field === 'familyName' ? 'family_name' :
                          field === 'customAttributes' ? 'custom_attributes' :
                          field === 'mfaEnabled' ? 'mfa_enabled' :
                          field === 'lastLogin' ? 'last_login' :
                          field;

          setParts.push(`${dbField} = $${paramIndex++}`);
          
          if (field === 'customAttributes') {
            values.push(JSON.stringify(updates[field as keyof UserData]));
          } else {
            values.push(updates[field as keyof UserData]);
          }
        }
      }

      values.push(poolId, userId);

      const result = await client.query(
        `UPDATE users SET ${setParts.join(', ')} WHERE pool_id = $${paramIndex++} AND id = $${paramIndex} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw new Error(`User not found: ${userId} in pool ${poolId}`);
      }

      return this.mapUserRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async deleteUser(poolId: string, userId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'DELETE FROM users WHERE pool_id = $1 AND id = $2',
        [poolId, userId]
      );

      if (result.rowCount === 0) {
        throw new Error(`User not found: ${userId} in pool ${poolId}`);
      }
    } finally {
      client.release();
    }
  }

  // Client operations
  async createClient(client: Omit<ClientData, 'createdAt' | 'updatedAt'>): Promise<ClientData> {
    const dbClient = await this.pool.connect();
    try {
      const result = await dbClient.query(
        `INSERT INTO clients (
          client_id, client_secret, client_name, pool_id, redirect_uris,
          post_logout_redirect_uris, response_types, grant_types, scope,
          token_endpoint_auth_method, application_type, settings
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          client.clientId,
          client.clientSecret,
          client.clientName,
          client.poolId,
          client.redirectUris,
          client.postLogoutRedirectUris,
          client.responseTypes,
          client.grantTypes,
          client.scope,
          client.tokenEndpointAuthMethod,
          client.applicationType,
          JSON.stringify(client.settings),
        ]
      );

      return this.mapClientRow(result.rows[0]);
    } finally {
      dbClient.release();
    }
  }

  async getClient(clientId: string): Promise<ClientData | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT * FROM clients WHERE client_id = $1', [clientId]);
      return result.rows.length > 0 ? this.mapClientRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async listClients(poolId?: string): Promise<ClientData[]> {
    const client = await this.pool.connect();
    try {
      let query = 'SELECT * FROM clients';
      const values: any[] = [];

      if (poolId) {
        query += ' WHERE pool_id = $1';
        values.push(poolId);
      }

      query += ' ORDER BY created_at DESC';

      const result = await client.query(query, values);
      return result.rows.map(row => this.mapClientRow(row));
    } finally {
      client.release();
    }
  }

  async updateClient(clientId: string, updates: Partial<ClientData>): Promise<ClientData> {
    const client = await this.pool.connect();
    try {
      const setParts: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      const updateableFields = [
        'clientSecret', 'clientName', 'redirectUris', 'postLogoutRedirectUris',
        'responseTypes', 'grantTypes', 'scope', 'tokenEndpointAuthMethod',
        'applicationType', 'settings'
      ];

      for (const field of updateableFields) {
        if (updates[field as keyof ClientData] !== undefined) {
          const dbField = field === 'clientSecret' ? 'client_secret' :
                          field === 'clientName' ? 'client_name' :
                          field === 'redirectUris' ? 'redirect_uris' :
                          field === 'postLogoutRedirectUris' ? 'post_logout_redirect_uris' :
                          field === 'responseTypes' ? 'response_types' :
                          field === 'grantTypes' ? 'grant_types' :
                          field === 'tokenEndpointAuthMethod' ? 'token_endpoint_auth_method' :
                          field === 'applicationType' ? 'application_type' :
                          field;

          setParts.push(`${dbField} = $${paramIndex++}`);
          
          if (field === 'settings') {
            values.push(JSON.stringify(updates[field as keyof ClientData]));
          } else {
            values.push(updates[field as keyof ClientData]);
          }
        }
      }

      values.push(clientId);

      const result = await client.query(
        `UPDATE clients SET ${setParts.join(', ')} WHERE client_id = $${paramIndex} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw new Error(`Client not found: ${clientId}`);
      }

      return this.mapClientRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async deleteClient(clientId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('DELETE FROM clients WHERE client_id = $1', [clientId]);
      if (result.rowCount === 0) {
        throw new Error(`Client not found: ${clientId}`);
      }
    } finally {
      client.release();
    }
  }

  // Group operations
  async createGroup(group: Omit<GroupData, 'groupId' | 'createdAt' | 'updatedAt'>): Promise<GroupData> {
    const client = await this.pool.connect();
    try {
      const groupId = uuidv4();
      const result = await client.query(
        `INSERT INTO groups (group_id, pool_id, group_name, description, permissions)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [groupId, group.poolId, group.groupName, group.description, group.permissions]
      );

      return this.mapGroupRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async getGroup(poolId: string, groupId: string): Promise<GroupData | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM groups WHERE pool_id = $1 AND group_id = $2',
        [poolId, groupId]
      );

      return result.rows.length > 0 ? this.mapGroupRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async listGroups(poolId: string): Promise<GroupData[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM groups WHERE pool_id = $1 ORDER BY group_name',
        [poolId]
      );

      return result.rows.map(row => this.mapGroupRow(row));
    } finally {
      client.release();
    }
  }

  async updateGroup(poolId: string, groupId: string, updates: Partial<GroupData>): Promise<GroupData> {
    const client = await this.pool.connect();
    try {
      const setParts: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.groupName !== undefined) {
        setParts.push(`group_name = $${paramIndex++}`);
        values.push(updates.groupName);
      }
      if (updates.description !== undefined) {
        setParts.push(`description = $${paramIndex++}`);
        values.push(updates.description);
      }
      if (updates.permissions !== undefined) {
        setParts.push(`permissions = $${paramIndex++}`);
        values.push(updates.permissions);
      }

      values.push(poolId, groupId);

      const result = await client.query(
        `UPDATE groups SET ${setParts.join(', ')} WHERE pool_id = $${paramIndex++} AND group_id = $${paramIndex} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw new Error(`Group not found: ${groupId} in pool ${poolId}`);
      }

      return this.mapGroupRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async deleteGroup(poolId: string, groupId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Remove group from all users
      await client.query(
        'UPDATE users SET groups = array_remove(groups, $1) WHERE pool_id = $2',
        [groupId, poolId]
      );

      // Delete the group
      const result = await client.query(
        'DELETE FROM groups WHERE pool_id = $1 AND group_id = $2',
        [poolId, groupId]
      );

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        throw new Error(`Group not found: ${groupId} in pool ${poolId}`);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // User-Group operations
  async addUserToGroup(poolId: string, userId: string, groupId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE users 
         SET groups = array_append(groups, $1) 
         WHERE pool_id = $2 AND id = $3 AND NOT ($1 = ANY(groups))`,
        [groupId, poolId, userId]
      );

      if (result.rowCount === 0) {
        throw new Error(`User not found or already in group: ${userId}`);
      }
    } finally {
      client.release();
    }
  }

  async removeUserFromGroup(poolId: string, userId: string, groupId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE users 
         SET groups = array_remove(groups, $1) 
         WHERE pool_id = $2 AND id = $3`,
        [groupId, poolId, userId]
      );

      if (result.rowCount === 0) {
        throw new Error(`User not found: ${userId} in pool ${poolId}`);
      }
    } finally {
      client.release();
    }
  }

  async getUserGroups(poolId: string, userId: string): Promise<GroupData[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT g.* FROM groups g 
         JOIN users u ON g.group_id = ANY(u.groups)
         WHERE g.pool_id = $1 AND u.id = $2`,
        [poolId, userId]
      );

      return result.rows.map(row => this.mapGroupRow(row));
    } finally {
      client.release();
    }
  }

  async getGroupUsers(poolId: string, groupId: string): Promise<UserData[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM users WHERE pool_id = $1 AND $2 = ANY(groups)',
        [poolId, groupId]
      );

      return result.rows.map(row => this.mapUserRow(row));
    } finally {
      client.release();
    }
  }

  // MFA Device operations
  async createMfaDevice(device: Omit<MfaDeviceData, 'deviceId' | 'createdAt' | 'updatedAt'>): Promise<MfaDeviceData> {
    const client = await this.pool.connect();
    try {
      const deviceId = uuidv4();
      const result = await client.query(
        `INSERT INTO mfa_devices (device_id, pool_id, user_id, device_name, device_type, secret_key, is_verified, backup_codes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [deviceId, device.poolId, device.userId, device.deviceName, device.deviceType, device.secretKey, device.isVerified, device.backupCodes]
      );
      
      return this.mapMfaDeviceRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async getMfaDevice(poolId: string, userId: string, deviceId: string): Promise<MfaDeviceData | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM mfa_devices WHERE pool_id = $1 AND user_id = $2 AND device_id = $3',
        [poolId, userId, deviceId]
      );
      
      return result.rows.length > 0 ? this.mapMfaDeviceRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async listUserMfaDevices(poolId: string, userId: string): Promise<MfaDeviceData[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM mfa_devices WHERE pool_id = $1 AND user_id = $2 ORDER BY created_at ASC',
        [poolId, userId]
      );
      
      return result.rows.map(row => this.mapMfaDeviceRow(row));
    } finally {
      client.release();
    }
  }

  async updateMfaDevice(poolId: string, userId: string, deviceId: string, updates: Partial<MfaDeviceData>): Promise<MfaDeviceData> {
    const client = await this.pool.connect();
    try {
      const setParts: string[] = [];
      const values: any[] = [];
      let valueIndex = 1;

      // Build dynamic SET clause
      Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined && key !== 'deviceId' && key !== 'createdAt' && key !== 'updatedAt') {
          const dbColumn = this.camelToSnakeCase(key);
          setParts.push(`${dbColumn} = $${valueIndex}`);
          values.push(value);
          valueIndex++;
        }
      });

      if (setParts.length === 0) {
        throw new Error('No valid fields to update');
      }

      values.push(poolId, userId, deviceId);
      const whereClause = `pool_id = $${valueIndex} AND user_id = $${valueIndex + 1} AND device_id = $${valueIndex + 2}`;

      const result = await client.query(
        `UPDATE mfa_devices SET ${setParts.join(', ')} WHERE ${whereClause} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw new Error('MFA device not found');
      }

      return this.mapMfaDeviceRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async deleteMfaDevice(poolId: string, userId: string, deviceId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'DELETE FROM mfa_devices WHERE pool_id = $1 AND user_id = $2 AND device_id = $3',
        [poolId, userId, deviceId]
      );

      if (result.rowCount === 0) {
        throw new Error('MFA device not found');
      }
    } finally {
      client.release();
    }
  }

  async verifyMfaDevice(poolId: string, userId: string, deviceId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'UPDATE mfa_devices SET is_verified = true, last_used = CURRENT_TIMESTAMP WHERE pool_id = $1 AND user_id = $2 AND device_id = $3',
        [poolId, userId, deviceId]
      );

      if (result.rowCount === 0) {
        throw new Error('MFA device not found');
      }
    } finally {
      client.release();
    }
  }

  async updateUserMfaStatus(poolId: string, userId: string, enabled: boolean): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'UPDATE users SET mfa_enabled = $1 WHERE pool_id = $2 AND id = $3',
        [enabled, poolId, userId]
      );

      if (result.rowCount === 0) {
        throw new Error('User not found');
      }
    } finally {
      client.release();
    }
  }

  // Helper methods to map database rows to interface objects
  private mapUserPoolRow(row: any): UserPoolData {
    return {
      poolId: row.pool_id,
      clientId: row.client_id,
      poolName: row.pool_name,
      customAttributes: row.custom_attributes || {},
      settings: row.settings || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapUserRow(row: any): UserData {
    return {
      userId: row.id,
      poolId: row.pool_id,
      email: row.email,
      emailVerified: row.email_verified,
      passwordHash: row.password_hash,
      name: row.name,
      givenName: row.given_name,
      familyName: row.family_name,
      nickname: row.nickname,
      picture: row.picture,
      website: row.website,
      customAttributes: row.custom_attributes || {},
      groups: row.groups || [],
      status: row.status,
      mfaEnabled: row.mfa_enabled,
      lastLogin: row.last_login,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapClientRow(row: any): ClientData {
    return {
      clientId: row.client_id,
      clientSecret: row.client_secret,
      clientName: row.client_name,
      poolId: row.pool_id,
      redirectUris: row.redirect_uris || [],
      postLogoutRedirectUris: row.post_logout_redirect_uris || [],
      responseTypes: row.response_types || [],
      grantTypes: row.grant_types || [],
      scope: row.scope,
      tokenEndpointAuthMethod: row.token_endpoint_auth_method,
      applicationType: row.application_type,
      settings: row.settings || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapGroupRow(row: any): GroupData {
    return {
      groupId: row.group_id,
      poolId: row.pool_id,
      groupName: row.group_name,
      description: row.description,
      permissions: row.permissions || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapMfaDeviceRow(row: any): MfaDeviceData {
    return {
      deviceId: row.device_id,
      poolId: row.pool_id,
      userId: row.user_id,
      deviceName: row.device_name,
      deviceType: row.device_type,
      secretKey: row.secret_key,
      isVerified: row.is_verified,
      backupCodes: row.backup_codes || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastUsed: row.last_used,
    };
  }

  private camelToSnakeCase(camelCaseStr: string): string {
    return camelCaseStr.replace(/([A-Z])/g, '_$1').toLowerCase();
  }
}
