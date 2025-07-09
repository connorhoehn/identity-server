-- Database Migration Script for Multi-Tenant Identity Server
-- This script migrates the existing single-tenant schema to multi-tenant

-- Start transaction for the migration
BEGIN;

-- Check if we already have the new schema (pool_id columns exist)
DO $$
DECLARE
    table_exists BOOLEAN;
    pool_id_exists BOOLEAN;
BEGIN
    -- Check if users table exists
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users'
    ) INTO table_exists;
    
    IF table_exists THEN
        -- Check if pool_id column exists in users table
        SELECT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'pool_id'
        ) INTO pool_id_exists;
        
        IF pool_id_exists THEN
            RAISE NOTICE 'Tables already migrated to multi-tenant schema. Skipping migration...';
        ELSE
            RAISE NOTICE 'Starting migration from single-tenant to multi-tenant schema...';
            
            -- Backup existing tables by renaming them
            ALTER TABLE users RENAME TO users_backup_pre_migration;
            ALTER TABLE clients RENAME TO clients_backup_pre_migration;
            
            -- Drop old indexes that might conflict
            DROP INDEX IF EXISTS idx_users_email;
            DROP INDEX IF EXISTS idx_clients_client_id;
            
            RAISE NOTICE 'Existing tables backed up successfully';
        END IF;
    ELSE
        RAISE NOTICE 'No existing tables found. Will create new multi-tenant schema...';
    END IF;
END $$;

-- Create the new multi-tenant schema

-- User Pools table
CREATE TABLE IF NOT EXISTS user_pools (
    pool_id VARCHAR(255) PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL,
    pool_name VARCHAR(255) NOT NULL,
    custom_attributes JSONB DEFAULT '{}',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users table with multi-tenant support
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    pool_id VARCHAR(255) NOT NULL REFERENCES user_pools(pool_id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    password_hash VARCHAR(255),
    name VARCHAR(255),
    given_name VARCHAR(255),
    family_name VARCHAR(255),
    nickname VARCHAR(255),
    picture TEXT,
    website TEXT,
    custom_attributes JSONB DEFAULT '{}',
    groups TEXT[] DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'UNCONFIRMED',
    mfa_enabled BOOLEAN DEFAULT FALSE,
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pool_id, email)
);

-- Clients table with multi-tenant support
CREATE TABLE IF NOT EXISTS clients (
    client_id VARCHAR(255) PRIMARY KEY,
    client_secret VARCHAR(255),
    client_name VARCHAR(255) NOT NULL,
    pool_id VARCHAR(255) NOT NULL REFERENCES user_pools(pool_id) ON DELETE CASCADE,
    redirect_uris TEXT[] DEFAULT '{}',
    post_logout_redirect_uris TEXT[] DEFAULT '{}',
    response_types TEXT[] DEFAULT '{"code"}',
    grant_types TEXT[] DEFAULT '{"authorization_code", "refresh_token"}',
    scope VARCHAR(500) DEFAULT 'openid profile email',
    token_endpoint_auth_method VARCHAR(50) DEFAULT 'client_secret_basic',
    application_type VARCHAR(50) DEFAULT 'web',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Groups table with multi-tenant support
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    pool_id VARCHAR(255) NOT NULL REFERENCES user_pools(pool_id) ON DELETE CASCADE,
    group_name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pool_id, group_name)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_pool_email ON users(pool_id, email);
CREATE INDEX IF NOT EXISTS idx_users_pool_id ON users(pool_id);
CREATE INDEX IF NOT EXISTS idx_clients_pool_id ON clients(pool_id);
CREATE INDEX IF NOT EXISTS idx_groups_pool_id ON groups(pool_id);
CREATE INDEX IF NOT EXISTS idx_user_pools_client_id ON user_pools(client_id);

-- Migrate existing data if backup tables exist
DO $$
DECLARE
    user_count INTEGER;
    client_count INTEGER;
    default_pool_id VARCHAR(255) := 'default-pool';
    default_client_id VARCHAR(255) := 'local-test-client';
    backup_users_exists BOOLEAN;
    backup_clients_exists BOOLEAN;
    user_record RECORD;
    client_record RECORD;
BEGIN
    -- Check if backup tables exist
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users_backup_pre_migration'
    ) INTO backup_users_exists;
    
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'clients_backup_pre_migration'
    ) INTO backup_clients_exists;
    
    IF backup_users_exists OR backup_clients_exists THEN
        RAISE NOTICE 'Found backup tables. Starting data migration...';
        
        -- Create default user pool
        INSERT INTO user_pools (pool_id, client_id, pool_name, settings) VALUES (
            default_pool_id,
            default_client_id,
            'Default Pool',
            '{"passwordPolicy": {"minLength": 8, "requireUppercase": true, "requireLowercase": true, "requireNumbers": true, "requireSymbols": false}, "mfaConfiguration": "OFF", "accountRecovery": {"email": true, "sms": false}}'
        ) ON CONFLICT (pool_id) DO NOTHING;
        
        -- Migrate users if backup exists
        IF backup_users_exists THEN
            -- Get count of users to migrate
            SELECT COUNT(*) INTO user_count FROM users_backup_pre_migration;
            RAISE NOTICE 'Migrating % users to default pool...', user_count;
            
            -- Insert users into new schema
            FOR user_record IN SELECT * FROM users_backup_pre_migration LOOP
                INSERT INTO users (
                    pool_id, email, email_verified, password_hash, name, 
                    given_name, family_name, nickname, picture, website,
                    status, mfa_enabled, created_at, updated_at
                ) VALUES (
                    default_pool_id,
                    user_record.email,
                    COALESCE(user_record.email_verified, false),
                    user_record.password_hash,
                    user_record.name,
                    user_record.given_name,
                    user_record.family_name,
                    user_record.nickname,
                    user_record.picture,
                    user_record.website,
                    'CONFIRMED',
                    false,
                    COALESCE(user_record.created_at, CURRENT_TIMESTAMP),
                    COALESCE(user_record.updated_at, CURRENT_TIMESTAMP)
                ) ON CONFLICT (pool_id, email) DO NOTHING;
            END LOOP;
            
            RAISE NOTICE 'Successfully migrated % users', user_count;
        END IF;
        
        -- Migrate clients if backup exists
        IF backup_clients_exists THEN
            -- Get count of clients to migrate
            SELECT COUNT(*) INTO client_count FROM clients_backup_pre_migration;
            RAISE NOTICE 'Migrating % clients...', client_count;
            
            -- Insert clients into new schema
            FOR client_record IN SELECT * FROM clients_backup_pre_migration LOOP
                -- Use default pool for the default client, create separate pools for others
                IF client_record.client_id = default_client_id THEN
                    -- Insert default client with default pool
                    INSERT INTO clients (
                        client_id, client_secret, client_name, pool_id,
                        redirect_uris, response_types,
                        grant_types, scope, token_endpoint_auth_method,
                        created_at, updated_at
                    ) VALUES (
                        client_record.client_id,
                        client_record.client_secret,
                        COALESCE(client_record.client_name, 'Default Client'),
                        default_pool_id,
                        COALESCE(client_record.redirect_uris, '{}'),
                        COALESCE(client_record.response_types, '{"code"}'),
                        COALESCE(client_record.grant_types, '{"authorization_code", "refresh_token"}'),
                        COALESCE(client_record.scope, 'openid profile email'),
                        COALESCE(client_record.token_endpoint_auth_method, 'client_secret_basic'),
                        COALESCE(client_record.created_at, CURRENT_TIMESTAMP),
                        COALESCE(client_record.updated_at, CURRENT_TIMESTAMP)
                    ) ON CONFLICT (client_id) DO NOTHING;
                ELSE
                    -- Create separate pool for other clients
                    DECLARE
                        client_pool_id VARCHAR(255) := 'pool-' || client_record.client_id;
                    BEGIN
                        -- Create user pool for this client
                        INSERT INTO user_pools (pool_id, client_id, pool_name, settings) VALUES (
                            client_pool_id,
                            client_record.client_id,
                            'Pool for ' || COALESCE(client_record.client_name, client_record.client_id),
                            '{"passwordPolicy": {"minLength": 8, "requireUppercase": true, "requireLowercase": true, "requireNumbers": true, "requireSymbols": false}, "mfaConfiguration": "OFF", "accountRecovery": {"email": true, "sms": false}}'
                        ) ON CONFLICT (pool_id) DO NOTHING;
                        
                        -- Insert client with its own pool
                        INSERT INTO clients (
                            client_id, client_secret, client_name, pool_id,
                            redirect_uris, response_types,
                            grant_types, scope, token_endpoint_auth_method,
                            created_at, updated_at
                        ) VALUES (
                            client_record.client_id,
                            client_record.client_secret,
                            COALESCE(client_record.client_name, client_record.client_id),
                            client_pool_id,
                            COALESCE(client_record.redirect_uris, '{}'),
                            COALESCE(client_record.response_types, '{"code"}'),
                            COALESCE(client_record.grant_types, '{"authorization_code", "refresh_token"}'),
                            COALESCE(client_record.scope, 'openid profile email'),
                            COALESCE(client_record.token_endpoint_auth_method, 'client_secret_basic'),
                            COALESCE(client_record.created_at, CURRENT_TIMESTAMP),
                            COALESCE(client_record.updated_at, CURRENT_TIMESTAMP)
                        ) ON CONFLICT (client_id) DO NOTHING;
                    END;
                END IF;
            END LOOP;
            
            RAISE NOTICE 'Successfully migrated % clients', client_count;
        END IF;
        
        RAISE NOTICE 'Data migration completed successfully!';
    ELSE
        RAISE NOTICE 'No existing data found to migrate. Creating fresh multi-tenant schema...';
        
        -- Create default user pool for fresh installation
        INSERT INTO user_pools (pool_id, client_id, pool_name, settings) VALUES (
            default_pool_id,
            default_client_id,
            'Default Pool',
            '{"passwordPolicy": {"minLength": 8, "requireUppercase": true, "requireLowercase": true, "requireNumbers": true, "requireSymbols": false}, "mfaConfiguration": "OFF", "accountRecovery": {"email": true, "sms": false}}'
        ) ON CONFLICT (pool_id) DO NOTHING;
        
        -- Create default client
        INSERT INTO clients (
            client_id, client_secret, client_name, pool_id,
            redirect_uris, post_logout_redirect_uris, response_types,
            grant_types, scope, token_endpoint_auth_method, application_type
        ) VALUES (
            default_client_id,
            'local-test-client-secret',
            'Local Test Client',
            default_pool_id,
            '{"http://localhost:3006/callback", "http://localhost:3007/callback"}',
            '{}',
            '{"code"}',
            '{"authorization_code", "refresh_token"}',
            'openid profile email',
            'client_secret_basic',
            'web'
        ) ON CONFLICT (client_id) DO NOTHING;
        
        RAISE NOTICE 'Fresh multi-tenant schema created with default pool and client';
    END IF;
END $$;

COMMIT;
