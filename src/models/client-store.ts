import { DynamoDBService } from '../services/dynamodb.js';

export interface ClientConfig {
  client_id: string;
  client_secret: string;
  client_name: string;
  grant_types: string[];
  redirect_uris: string[];
  post_logout_redirect_uris: string[];
  response_types: string[];
  scope: string;
  token_endpoint_auth_method: string;
  application_type: string;
  custom_user_attributes?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export class ClientStore {
  private static dynamodb = DynamoDBService.getInstance();

  static async loadClients(): Promise<ClientConfig[]> {
    try {
      const clients = await this.dynamodb.scan('clients');
      
      // Always include the default test client for development
      const defaultClient: ClientConfig = {
        client_id: process.env.CLIENT_ID || 'local-test-client',
        client_secret: process.env.CLIENT_SECRET || 'local-test-client-secret',
        client_name: 'Local Test Client',
        grant_types: ['authorization_code', 'refresh_token'],
        redirect_uris: ['http://localhost:3006/callback'],
        post_logout_redirect_uris: ['http://localhost:3006/', 'http://localhost:3006/logout-callback'],
        response_types: ['code'],
        scope: 'openid profile email',
        token_endpoint_auth_method: 'client_secret_basic',
        application_type: 'web',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return [defaultClient, ...clients];
    } catch (error) {
      console.error('Error loading clients:', error);
      // Fallback to default client only
      return [{
        client_id: process.env.CLIENT_ID || 'local-test-client',
        client_secret: process.env.CLIENT_SECRET || 'local-test-client-secret',
        client_name: 'Local Test Client',
        grant_types: ['authorization_code', 'refresh_token'],
        redirect_uris: ['http://localhost:3006/callback'],
        post_logout_redirect_uris: ['http://localhost:3006/', 'http://localhost:3006/logout-callback'],
        response_types: ['code'],
        scope: 'openid profile email',
        token_endpoint_auth_method: 'client_secret_basic',
        application_type: 'web',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }];
    }
  }

  static async createClient(clientData: Omit<ClientConfig, 'created_at' | 'updated_at'>): Promise<ClientConfig> {
    const client: ClientConfig = {
      ...clientData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await this.dynamodb.put('clients', client.client_id, client);
    return client;
  }

  static async getClient(clientId: string): Promise<ClientConfig | null> {
    try {
      return await this.dynamodb.get('clients', clientId);
    } catch (error) {
      return null;
    }
  }

  static async updateClient(clientId: string, updates: Partial<ClientConfig>): Promise<ClientConfig | null> {
    const client = await this.getClient(clientId);
    if (!client) return null;

    const updatedClient = {
      ...client,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    await this.dynamodb.put('clients', clientId, updatedClient);
    return updatedClient;
  }

  static async deleteClient(clientId: string): Promise<boolean> {
    try {
      await this.dynamodb.delete('clients', clientId);
      return true;
    } catch (error) {
      return false;
    }
  }
}
