import { getDataProvider } from '../providers/data-provider-factory.js';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

export async function migrateToMultiTenant() {
  logger.info('Starting migration to multi-tenant architecture...');

  const dataProvider = getDataProvider();
  await dataProvider.connect();

  // Only run migration for PostgreSQL
  if (process.env.DATA_PROVIDER !== 'postgresql') {
    logger.info('Migration only supported for PostgreSQL. Skipping...');
    return;
  }

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'identity_server',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if migration is needed (if old tables exist without pool_id columns)
    const oldUsersResult = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'pool_id'
    `);

    if (oldUsersResult.rows.length > 0) {
      logger.info('Tables already migrated. Skipping migration...');
      await client.query('ROLLBACK');
      return;
    }

    // Check if old users table exists
    const usersTableExists = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name = 'users'
    `);

    if (usersTableExists.rows.length === 0) {
      logger.info('No existing data to migrate. Skipping migration...');
      await client.query('ROLLBACK');
      return;
    }

    logger.info('Migrating existing data...');

    // Create default user pool
    const defaultPoolId = 'default-pool';
    const defaultClientId = process.env.CLIENT_ID || 'local-test-client';

    // Create default user pool in new structure
    await dataProvider.createUserPool({
      poolId: defaultPoolId,
      clientId: defaultClientId,
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

    // Migrate existing users
    const existingUsers = await client.query('SELECT * FROM users');
    
    for (const user of existingUsers.rows) {
      await dataProvider.createUser({
        poolId: defaultPoolId,
        email: user.email,
        emailVerified: user.email_verified || false,
        passwordHash: user.password_hash,
        name: user.name,
        givenName: user.given_name,
        familyName: user.family_name,
        nickname: user.nickname,
        picture: user.picture,
        website: user.website,
        customAttributes: {},
        groups: [],
        status: 'CONFIRMED',
        mfaEnabled: false,
      });
    }

    // Migrate existing clients
    const existingClients = await client.query('SELECT * FROM clients');
    
    for (const clientRow of existingClients.rows) {
      // Skip the default client as it's already associated with the default pool
      if (clientRow.client_id === defaultClientId) {
        // Update the existing client with pool association
        await dataProvider.updateClient(clientRow.client_id, {
          poolId: defaultPoolId,
        });
        continue;
      }

      // Create separate pools for other clients
      const clientPoolId = `pool-${clientRow.client_id}`;
      
      await dataProvider.createUserPool({
        poolId: clientPoolId,
        clientId: clientRow.client_id,
        poolName: `Pool for ${clientRow.client_name}`,
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

      await dataProvider.createClient({
        clientId: clientRow.client_id,
        clientSecret: clientRow.client_secret,
        clientName: clientRow.client_name,
        poolId: clientPoolId,
        redirectUris: clientRow.redirect_uris || [],
        postLogoutRedirectUris: clientRow.post_logout_redirect_uris || [],
        responseTypes: clientRow.response_types || ['code'],
        grantTypes: clientRow.grant_types || ['authorization_code', 'refresh_token'],
        scope: clientRow.scope || 'openid profile email',
        tokenEndpointAuthMethod: clientRow.token_endpoint_auth_method || 'client_secret_basic',
        applicationType: clientRow.application_type || 'web',
        settings: {},
      });
    }

    // Backup old tables by renaming them
    await client.query('ALTER TABLE users RENAME TO users_backup_pre_migration');
    await client.query('ALTER TABLE clients RENAME TO clients_backup_pre_migration');
    
    // Drop old indexes that might conflict
    await client.query('DROP INDEX IF EXISTS idx_users_email');
    await client.query('DROP INDEX IF EXISTS idx_clients_client_id');

    await client.query('COMMIT');
    logger.info('Migration completed successfully!');
    
    logger.info(`
Migration Summary:
- Created default user pool: ${defaultPoolId}
- Migrated ${existingUsers.rows.length} users to default pool
- Migrated ${existingClients.rows.length} clients with pool associations
- Old tables backed up as users_backup_pre_migration and clients_backup_pre_migration
- You can remove backup tables after verifying the migration worked correctly
    `);

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// CLI script runner
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateToMultiTenant()
    .then(() => {
      logger.info('Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migration script failed:', error);
      process.exit(1);
    });
}
