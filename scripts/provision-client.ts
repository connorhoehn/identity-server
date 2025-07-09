#!/usr/bin/env tsx

import { Client } from '../src/models/client.js';
import { logger } from '../src/utils/logger.js';
import { config } from 'dotenv';

// Load environment variables
config();

interface ClientConfig {
  client_name: string;
  client_id?: string;
  client_secret?: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
}

const DEFAULT_CLIENTS: Record<string, ClientConfig> = {
  'test-client': {
    client_name: 'Test Client Application',
    client_id: 'test-client',
    client_secret: 'test-secret',
    redirect_uris: ['http://localhost:3001/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'openid profile email',
    token_endpoint_auth_method: 'client_secret_basic'
  },
  'dev-app': {
    client_name: 'Development Application',
    client_id: 'dev-app-client',
    redirect_uris: ['http://localhost:3000/auth/callback', 'http://localhost:8080/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'openid profile email',
    token_endpoint_auth_method: 'client_secret_basic'
  },
  'mobile-app': {
    client_name: 'Mobile Application',
    client_id: 'mobile-app-client',
    redirect_uris: ['myapp://callback', 'http://localhost/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'openid profile email',
    token_endpoint_auth_method: 'none' // PKCE only for mobile apps
  }
};

async function provisionClient(clientKey: string, config?: ClientConfig): Promise<void> {
  try {
    const clientConfig = config || DEFAULT_CLIENTS[clientKey];
    
    if (!clientConfig) {
      throw new Error(`No configuration found for client key: ${clientKey}`);
    }

    // Check if client already exists
    const existingClient = await Client.findByClientId(clientConfig.client_id || clientKey);
    
    if (existingClient) {
      logger.info(`Client '${clientConfig.client_name}' (${clientConfig.client_id || clientKey}) already exists`);
      console.log(`✓ Client already exists:`);
      console.log(`  Client ID: ${existingClient.clientId}`);
      console.log(`  Client Name: ${existingClient.clientName}`);
      console.log(`  Redirect URIs: ${existingClient.redirectUris.join(', ')}`);
      console.log(`  Grant Types: ${existingClient.grantTypes.join(', ')}`);
      console.log(`  Response Types: ${existingClient.responseTypes.join(', ')}`);
      console.log(`  Scope: ${existingClient.scope}`);
      return;
    }

    // Create new client
    const newClient = await Client.create(clientConfig);
    
    logger.info(`Created new client: ${newClient.clientName} (${newClient.clientId})`);
    console.log(`✓ Successfully created client:`);
    console.log(`  Client ID: ${newClient.clientId}`);
    console.log(`  Client Secret: ${newClient.clientSecret}`);
    console.log(`  Client Name: ${newClient.clientName}`);
    console.log(`  Redirect URIs: ${newClient.redirectUris.join(', ')}`);
    console.log(`  Grant Types: ${newClient.grantTypes.join(', ')}`);
    console.log(`  Response Types: ${newClient.responseTypes.join(', ')}`);
    console.log(`  Scope: ${newClient.scope}`);
    console.log(`  Token Endpoint Auth Method: ${newClient.tokenEndpointAuthMethod}`);
    
  } catch (error) {
    logger.error(`Failed to provision client '${clientKey}':`, error);
    console.error(`✗ Failed to provision client '${clientKey}':`, error.message);
    throw error;
  }
}

async function deleteClient(clientIdOrKey: string): Promise<void> {
  try {
    // First try to find by client_id
    let client = await Client.findByClientId(clientIdOrKey);
    
    // If not found, try to find by predefined client key
    if (!client && DEFAULT_CLIENTS[clientIdOrKey]) {
      const defaultClientId = DEFAULT_CLIENTS[clientIdOrKey].client_id || clientIdOrKey;
      client = await Client.findByClientId(defaultClientId);
    }
    
    if (!client) {
      console.log(`✗ Client '${clientIdOrKey}' not found`);
      return;
    }

    const success = await Client.delete(client.id);
    
    if (success) {
      logger.info(`Deleted client: ${client.clientName} (${client.clientId})`);
      console.log(`✓ Successfully deleted client:`);
      console.log(`  Client ID: ${client.clientId}`);
      console.log(`  Client Name: ${client.clientName}`);
    } else {
      throw new Error('Delete operation failed');
    }
    
  } catch (error) {
    logger.error(`Failed to delete client '${clientIdOrKey}':`, error);
    console.error(`✗ Failed to delete client '${clientIdOrKey}':`, error.message);
    throw error;
  }
}

async function listClients(): Promise<void> {
  try {
    const clients = await Client.findAll();
    
    if (clients.length === 0) {
      console.log('No clients found in the database.');
      return;
    }
    
    console.log(`Found ${clients.length} client(s):\n`);
    
    clients.forEach((client, index) => {
      console.log(`${index + 1}. ${client.clientName}`);
      console.log(`   Client ID: ${client.clientId}`);
      console.log(`   Redirect URIs: ${client.redirectUris.join(', ')}`);
      console.log(`   Grant Types: ${client.grantTypes.join(', ')}`);
      console.log(`   Response Types: ${client.responseTypes.join(', ')}`);
      console.log(`   Scope: ${client.scope}`);
      console.log(`   Auth Method: ${client.tokenEndpointAuthMethod}`);
      console.log(`   Created: ${client.createdAt.toISOString()}`);
      console.log('');
    });
    
  } catch (error) {
    logger.error('Failed to list clients:', error);
    console.error('✗ Failed to list clients:', error.message);
    throw error;
  }
}

async function provisionFromConfig(configPath: string): Promise<void> {
  try {
    const { readFile } = await import('fs/promises');
    const configContent = await readFile(configPath, 'utf-8');
    const clientConfigs: Record<string, ClientConfig> = JSON.parse(configContent);
    
    console.log(`Provisioning clients from config file: ${configPath}\n`);
    
    for (const [clientKey, config] of Object.entries(clientConfigs)) {
      console.log(`Provisioning client: ${clientKey}`);
      await provisionClient(clientKey, config);
      console.log('');
    }
    
  } catch (error) {
    logger.error(`Failed to provision from config file '${configPath}':`, error);
    console.error(`✗ Failed to provision from config file '${configPath}':`, error.message);
    throw error;
  }
}

function printUsage(): void {
  console.log(`
OIDC Client Provisioning Script

Usage:
  tsx scripts/provision-client.ts <command> [options]

Commands:
  provision <client-key>           Provision a predefined client
  provision-custom <config.json>   Provision clients from a JSON config file
  delete <client-id>               Delete a client by client_id or client-key
  list                            List all existing clients
  help                            Show this help message

Predefined Clients:
  test-client     - Test Client Application (http://localhost:3001/callback)
  dev-app         - Development Application (http://localhost:3000/auth/callback)
  mobile-app      - Mobile Application (PKCE, myapp://callback)

Examples:
  tsx scripts/provision-client.ts provision test-client
  tsx scripts/provision-client.ts delete test-client
  tsx scripts/provision-client.ts list
  tsx scripts/provision-client.ts provision-custom ./clients-config.json

Custom Config File Format (JSON):
{
  "my-app": {
    "client_name": "My Application",
    "client_id": "my-app-client",
    "client_secret": "optional-secret",
    "redirect_uris": ["http://localhost:3000/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "scope": "openid profile email",
    "token_endpoint_auth_method": "client_secret_basic"
  }
}
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }
  
  const command = args[0];
  
  try {
    switch (command) {
      case 'provision':
        if (args.length < 2) {
          console.error('✗ Client key required for provision command');
          printUsage();
          process.exit(1);
        }
        await provisionClient(args[1]);
        break;
        
      case 'provision-custom':
        if (args.length < 2) {
          console.error('✗ Config file path required for provision-custom command');
          printUsage();
          process.exit(1);
        }
        await provisionFromConfig(args[1]);
        break;
        
      case 'delete':
        if (args.length < 2) {
          console.error('✗ Client ID or key required for delete command');
          printUsage();
          process.exit(1);
        }
        await deleteClient(args[1]);
        break;
        
      case 'list':
        await listClients();
        break;
        
      case 'help':
      case '--help':
      case '-h':
        printUsage();
        break;
        
      default:
        console.error(`✗ Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
    
  } catch (error) {
    console.error('\n✗ Script execution failed:', error.message);
    process.exit(1);
  }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { provisionClient, deleteClient, listClients, provisionFromConfig };
