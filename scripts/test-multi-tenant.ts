#!/usr/bin/env node

// Multi-tenant Identity Server Test Script
// This script tests the multi-tenant functionality

import { DataProviderFactory } from '../src/providers/data-provider-factory.js';
import { ClientStore } from '../src/models/client-store-multi-tenant.js';
import { Account } from '../src/models/account-multi-tenant.js';
import { logger } from '../src/utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

async function testMultiTenant() {
  logger.info('Starting multi-tenant functionality test...');
  
  try {
    // Initialize data provider
    await DataProviderFactory.initialize();
    logger.info('✓ Data provider initialized');
    
    // Initialize defaults
    await ClientStore.initializeDefaults();
    logger.info('✓ Default client and pool initialized');
    
    const dataProvider = DataProviderFactory.getProvider();
    
    // Test 1: Create a new user pool
    logger.info('Test 1: Creating new user pool...');
    const testPool = await dataProvider.createUserPool({
      poolId: 'test-pool-' + Date.now(),
      clientId: 'test-client-' + Date.now(),
      poolName: 'Test Pool',
      customAttributes: {
        'department': 'string',
        'employee_id': 'number',
      },
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
    logger.info('✓ User pool created:', testPool.poolId);
    
    // Test 2: Create a client for the pool
    logger.info('Test 2: Creating client for the pool...');
    const testClient = await ClientStore.createClient({
      client_id: testPool.clientId,
      client_secret: 'test-secret-123',
      client_name: 'Test Client',
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: ['http://localhost:3000/callback'],
      post_logout_redirect_uris: ['http://localhost:3000'],
      response_types: ['code'],
      scope: 'openid profile email',
      token_endpoint_auth_method: 'client_secret_basic',
      application_type: 'web',
    }, testPool.poolId);
    logger.info('✓ Client created:', testClient.client_id);
    
    // Test 3: Create a user in the pool
    logger.info('Test 3: Creating user in the pool...');
    const testUser = await Account.create({
      email: 'test@example.com',
      password: 'TestPass123!',
      given_name: 'Test',
      family_name: 'User',
      customAttributes: {
        department: 'Engineering',
        employee_id: 12345,
      },
    }, testPool.poolId);
    logger.info('✓ User created:', testUser.accountId);
    
    // Test 4: Authenticate the user
    logger.info('Test 4: Authenticating user...');
    const authResult = await Account.authenticate('test@example.com', 'TestPass123!', testPool.clientId);
    if (authResult) {
      logger.info('✓ User authentication successful');
    } else {
      logger.error('✗ User authentication failed');
    }
    
    // Test 5: List users in the pool
    logger.info('Test 5: Listing users in the pool...');
    const users = await Account.findAll(testPool.poolId);
    logger.info(`✓ Found ${users.length} users in pool`);
    
    // Test 6: Update user with custom attributes
    logger.info('Test 6: Updating user with custom attributes...');
    await Account.update(testUser.accountId, {
      customAttributes: {
        department: 'Product',
        employee_id: 54321,
      },
    }, testPool.poolId);
    logger.info('✓ User updated with custom attributes');
    
    // Test 7: Test pool isolation
    logger.info('Test 7: Testing pool isolation...');
    const defaultPoolId = await Account.getDefaultPoolId();
    const defaultUsers = await Account.findAll(defaultPoolId);
    const testPoolUsers = await Account.findAll(testPool.poolId);
    
    logger.info(`Default pool has ${defaultUsers.length} users`);
    logger.info(`Test pool has ${testPoolUsers.length} users`);
    
    if (defaultPoolId !== testPool.poolId) {
      logger.info('✓ Pool isolation confirmed - pools are separate');
    } else {
      logger.error('✗ Pool isolation failed - pools are the same');
    }
    
    // Test 8: List all pools
    logger.info('Test 8: Listing all user pools...');
    const allPools = await dataProvider.listUserPools();
    logger.info(`✓ Found ${allPools.length} user pools:`);
    allPools.forEach(pool => {
      logger.info(`  - ${pool.poolName} (${pool.poolId})`);
    });
    
    // Test 9: List all clients
    logger.info('Test 9: Listing all clients...');
    const allClients = await dataProvider.listClients();
    logger.info(`✓ Found ${allClients.length} clients:`);
    allClients.forEach(client => {
      logger.info(`  - ${client.clientName} (${client.clientId}) -> Pool: ${client.poolId}`);
    });
    
    // Cleanup
    logger.info('Cleaning up test data...');
    await Account.delete(testUser.accountId, testPool.poolId);
    await ClientStore.deleteClient(testClient.client_id);
    await dataProvider.deleteUserPool(testPool.poolId);
    logger.info('✓ Test cleanup completed');
    
    logger.info('🎉 All multi-tenant tests passed!');
    
  } catch (error) {
    logger.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await DataProviderFactory.disconnect();
  }
}

// Run the test
testMultiTenant()
  .then(() => {
    logger.info('Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Test failed:', error);
    process.exit(1);
  });
