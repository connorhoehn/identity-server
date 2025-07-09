#!/usr/bin/env node

/**
 * CLI tool for managing user pools and clients
 * Usage: node scripts/pool-manager.js <command> [options]
 */

import { getDataProvider } from '../src/providers/data-provider-factory.js';

const commands = {
  'list-pools': listPools,
  'create-pool': createPool,
  'list-clients': listClients,
  'create-client': createClient,
  'associate-client': associateClient,
};

async function listPools() {
  const dataProvider = getDataProvider();
  const pools = await dataProvider.listUserPools();
  
  console.log('\n📋 User Pools:');
  console.log('================');
  pools.forEach(pool => {
    console.log(`• ${pool.poolName} (${pool.poolId})`);
    console.log(`  Client: ${pool.clientId}`);
    console.log('');
  });
}

async function createPool() {
  const [, , , poolId, clientId, poolName] = process.argv;
  
  if (!poolId || !clientId || !poolName) {
    console.error('Usage: node pool-manager.js create-pool <poolId> <clientId> <poolName>');
    process.exit(1);
  }
  
  const dataProvider = getDataProvider();
  
  try {
    const pool = await dataProvider.createUserPool({
      poolId,
      clientId,
      poolName,
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
    
    console.log(`✅ Created user pool: ${pool.poolName} (${pool.poolId})`);
  } catch (error) {
    console.error(`❌ Error creating pool: ${error.message}`);
  }
}

async function listClients() {
  const dataProvider = getDataProvider();
  const clients = await dataProvider.listClients();
  
  console.log('\n📱 Clients:');
  console.log('============');
  clients.forEach(client => {
    console.log(`• ${client.clientName} (${client.clientId})`);
    console.log(`  Pool: ${client.poolId}`);
    console.log(`  Redirect URIs: ${client.redirectUris.join(', ')}`);
    console.log('');
  });
}

async function createClient() {
  const [, , , clientId, clientSecret, clientName, poolId, redirectUri] = process.argv;
  
  if (!clientId || !clientSecret || !clientName || !poolId || !redirectUri) {
    console.error('Usage: node pool-manager.js create-client <clientId> <clientSecret> <clientName> <poolId> <redirectUri>');
    process.exit(1);
  }
  
  const dataProvider = getDataProvider();
  
  try {
    const client = await dataProvider.createClient({
      clientId,
      clientSecret,
      clientName,
      poolId,
      redirectUris: [redirectUri],
      postLogoutRedirectUris: [redirectUri.replace('/callback', '/logout')],
      responseTypes: ['code'],
      grantTypes: ['authorization_code', 'refresh_token'],
      scope: 'openid profile email',
      tokenEndpointAuthMethod: 'client_secret_basic',
      applicationType: 'web',
      settings: {},
    });
    
    console.log(`✅ Created client: ${client.clientName} (${client.clientId})`);
  } catch (error) {
    console.error(`❌ Error creating client: ${error.message}`);
  }
}

async function associateClient() {
  const [, , , clientId, poolId] = process.argv;
  
  if (!clientId || !poolId) {
    console.error('Usage: node pool-manager.js associate-client <clientId> <poolId>');
    process.exit(1);
  }
  
  // This would require updating the client's poolId in the database
  console.log(`🔄 Associating client ${clientId} with pool ${poolId}...`);
  // Implementation would go here
}

// Main execution
const command = process.argv[2];

if (!command || !commands[command]) {
  console.log('\n🔧 User Pool Manager');
  console.log('====================');
  console.log('Available commands:');
  console.log('  list-pools                               List all user pools');
  console.log('  create-pool <poolId> <clientId> <name>   Create a new user pool');
  console.log('  list-clients                             List all clients');
  console.log('  create-client <id> <secret> <name> <poolId> <redirectUri>  Create a new client');
  console.log('  associate-client <clientId> <poolId>     Associate client with pool');
  console.log('\nExamples:');
  console.log('  node scripts/pool-manager.js list-pools');
  console.log('  node scripts/pool-manager.js create-pool app1-pool app1-client "App 1 Pool"');
  console.log('  node scripts/pool-manager.js create-client app1-client app1-secret "App 1" app1-pool http://localhost:3007/callback');
  process.exit(1);
}

commands[command]().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
