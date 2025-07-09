import { getDataProvider } from '../providers/data-provider-factory.js';
import { ClientData } from '../interfaces/data-provider.js';
import { logger } from '../utils/logger.js';

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
  static async loadClients(): Promise<ClientConfig[]> {
    try {
      const dataProvider = getDataProvider();
      const clients = await dataProvider.listClients();
      
      return clients.map(client => this.mapClientDataToConfig(client));
    } catch (error) {
      logger.error('Error loading clients:', error);
      
      // Fallback to default client only
      return [this.getDefaultClient()];
    }
  }

  static async createClient(clientData: Omit<ClientConfig, 'created_at' | 'updated_at'>, poolId: string): Promise<ClientConfig> {
    try {
      const dataProvider = getDataProvider();
      
      const client = await dataProvider.createClient({
        clientId: clientData.client_id,
        clientSecret: clientData.client_secret,
        clientName: clientData.client_name,
        poolId,
        redirectUris: clientData.redirect_uris,
        postLogoutRedirectUris: clientData.post_logout_redirect_uris,
        responseTypes: clientData.response_types,
        grantTypes: clientData.grant_types,
        scope: clientData.scope,
        tokenEndpointAuthMethod: clientData.token_endpoint_auth_method,
        applicationType: clientData.application_type,
        settings: {
          ...clientData.custom_user_attributes && { customUserAttributes: clientData.custom_user_attributes },
        } as any,
      });

      return this.mapClientDataToConfig(client);
    } catch (error) {
      logger.error('Error creating client:', error);
      throw error;
    }
  }

  static async getClient(clientId: string): Promise<ClientConfig | null> {
    try {
      const dataProvider = getDataProvider();
      const client = await dataProvider.getClient(clientId);
      
      if (!client) return null;
      
      return this.mapClientDataToConfig(client);
    } catch (error) {
      logger.error('Error getting client:', error);
      return null;
    }
  }

  static async updateClient(clientId: string, updates: Partial<ClientConfig>): Promise<ClientConfig | null> {
    try {
      const dataProvider = getDataProvider();
      
      const updateData: Partial<ClientData> = {};
      
      if (updates.client_secret !== undefined) {
        updateData.clientSecret = updates.client_secret;
      }
      
      if (updates.client_name !== undefined) {
        updateData.clientName = updates.client_name;
      }
      
      if (updates.redirect_uris !== undefined) {
        updateData.redirectUris = updates.redirect_uris;
      }
      
      if (updates.post_logout_redirect_uris !== undefined) {
        updateData.postLogoutRedirectUris = updates.post_logout_redirect_uris;
      }
      
      if (updates.response_types !== undefined) {
        updateData.responseTypes = updates.response_types;
      }
      
      if (updates.grant_types !== undefined) {
        updateData.grantTypes = updates.grant_types;
      }
      
      if (updates.scope !== undefined) {
        updateData.scope = updates.scope;
      }
      
      if (updates.token_endpoint_auth_method !== undefined) {
        updateData.tokenEndpointAuthMethod = updates.token_endpoint_auth_method;
      }
      
      if (updates.application_type !== undefined) {
        updateData.applicationType = updates.application_type;
      }
      
      if (updates.custom_user_attributes !== undefined) {
        updateData.settings = {
          ...updates.custom_user_attributes && { customUserAttributes: updates.custom_user_attributes },
        } as any;
      }

      const client = await dataProvider.updateClient(clientId, updateData);
      return this.mapClientDataToConfig(client);
    } catch (error) {
      logger.error('Error updating client:', error);
      return null;
    }
  }

  static async deleteClient(clientId: string): Promise<boolean> {
    try {
      const dataProvider = getDataProvider();
      await dataProvider.deleteClient(clientId);
      return true;
    } catch (error) {
      logger.error('Error deleting client:', error);
      return false;
    }
  }

  static async getClientsByPoolId(poolId: string): Promise<ClientConfig[]> {
    try {
      const dataProvider = getDataProvider();
      const clients = await dataProvider.listClients(poolId);
      
      return clients.map(client => this.mapClientDataToConfig(client));
    } catch (error) {
      logger.error('Error getting clients by pool ID:', error);
      return [];
    }
  }

  static async getClientWithPool(clientId: string): Promise<{ client: ClientConfig; poolId: string } | null> {
    try {
      const dataProvider = getDataProvider();
      const client = await dataProvider.getClient(clientId);
      
      if (!client) return null;
      
      return {
        client: this.mapClientDataToConfig(client),
        poolId: client.poolId,
      };
    } catch (error) {
      logger.error('Error getting client with pool:', error);
      return null;
    }
  }

  private static mapClientDataToConfig(client: ClientData): ClientConfig {
    return {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      client_name: client.clientName,
      grant_types: client.grantTypes,
      redirect_uris: client.redirectUris,
      post_logout_redirect_uris: client.postLogoutRedirectUris,
      response_types: client.responseTypes,
      scope: client.scope,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      application_type: client.applicationType,
      custom_user_attributes: (client.settings as any)?.customUserAttributes,
      created_at: client.createdAt.toISOString(),
      updated_at: client.updatedAt.toISOString(),
    };
  }

  private static getDefaultClient(): ClientConfig {
    return {
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
  }

  // Initialize default client and pool if they don't exist
  static async initializeDefaults(): Promise<void> {
    try {
      const dataProvider = getDataProvider();
      
      const defaultClientId = process.env.CLIENT_ID || 'local-test-client';
      const defaultPoolId = 'default-pool';
      
      // Check if default pool exists
      let userPool = await dataProvider.getUserPool(defaultPoolId);
      
      if (!userPool) {
        // Create default pool
        userPool = await dataProvider.createUserPool({
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

        logger.info('Created default user pool:', defaultPoolId);
      }

      // Check if default client exists
      const existingClient = await dataProvider.getClient(defaultClientId);
      
      if (!existingClient) {
        // Create default client
        const defaultClient = this.getDefaultClient();
        
        await dataProvider.createClient({
          clientId: defaultClient.client_id,
          clientSecret: defaultClient.client_secret,
          clientName: defaultClient.client_name,
          poolId: defaultPoolId,
          redirectUris: defaultClient.redirect_uris,
          postLogoutRedirectUris: defaultClient.post_logout_redirect_uris,
          responseTypes: defaultClient.response_types,
          grantTypes: defaultClient.grant_types,
          scope: defaultClient.scope,
          tokenEndpointAuthMethod: defaultClient.token_endpoint_auth_method,
          applicationType: defaultClient.application_type,
          settings: {},
        });

        logger.info('Created default client:', defaultClientId);
      }
    } catch (error) {
      logger.error('Error initializing defaults:', error);
    }
  }
}
