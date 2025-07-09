import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

interface ClientData {
  id: string;
  client_id: string;
  client_secret: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  scope: string;
  token_endpoint_auth_method: string;
  created_at: Date;
  updated_at: Date;
}

export class Client {
  public id: string;
  public clientId: string;
  public clientSecret: string;
  public clientName: string;
  public redirectUris: string[];
  public grantTypes: string[];
  public responseTypes: string[];
  public scope: string;
  public tokenEndpointAuthMethod: string;
  public createdAt: Date;
  public updatedAt: Date;

  constructor(data: ClientData) {
    this.id = data.id;
    this.clientId = data.client_id;
    this.clientSecret = data.client_secret;
    this.clientName = data.client_name;
    this.redirectUris = data.redirect_uris;
    this.grantTypes = data.grant_types;
    this.responseTypes = data.response_types;
    this.scope = data.scope;
    this.tokenEndpointAuthMethod = data.token_endpoint_auth_method;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  static async findAll(): Promise<Client[]> {
    try {
      const db = await Client.getDatabase();
      const result = await db.query(
        'SELECT * FROM clients ORDER BY created_at DESC'
      );

      return result.rows.map(row => new Client(row));
    } catch (error) {
      logger.error('Error finding clients:', error);
      return [];
    }
  }

  static async findById(id: string): Promise<Client | undefined> {
    try {
      const db = await Client.getDatabase();
      const result = await db.query(
        'SELECT * FROM clients WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return undefined;
      }

      return new Client(result.rows[0]);
    } catch (error) {
      logger.error('Error finding client by ID:', error);
      return undefined;
    }
  }

  static async findByClientId(clientId: string): Promise<Client | undefined> {
    try {
      const db = await Client.getDatabase();
      const result = await db.query(
        'SELECT * FROM clients WHERE client_id = $1',
        [clientId]
      );

      if (result.rows.length === 0) {
        return undefined;
      }

      return new Client(result.rows[0]);
    } catch (error) {
      logger.error('Error finding client by client_id:', error);
      return undefined;
    }
  }

  static async create(clientData: {
    client_name: string;
    client_id?: string;
    client_secret?: string;
    redirect_uris: string[];
    grant_types?: string[];
    response_types?: string[];
    scope?: string;
    token_endpoint_auth_method?: string;
  }): Promise<Client> {
    try {
      const db = await Client.getDatabase();
      const id = uuidv4();
      const clientId = clientData.client_id || `client_${uuidv4().replace(/-/g, '')}`;
      const clientSecret = clientData.client_secret || `secret_${uuidv4().replace(/-/g, '')}`;
      
      const grantTypes = clientData.grant_types || ['authorization_code', 'refresh_token'];
      const responseTypes = clientData.response_types || ['code'];
      const scope = clientData.scope || 'openid profile email';
      const tokenEndpointAuthMethod = clientData.token_endpoint_auth_method || 'client_secret_basic';

      const result = await db.query(
        `INSERT INTO clients 
         (id, client_id, client_secret, client_name, redirect_uris, grant_types, response_types, scope, token_endpoint_auth_method, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         RETURNING *`,
        [
          id,
          clientId,
          clientSecret,
          clientData.client_name,
          clientData.redirect_uris,
          grantTypes,
          responseTypes,
          scope,
          tokenEndpointAuthMethod,
        ]
      );

      return new Client(result.rows[0]);
    } catch (error) {
      logger.error('Error creating client:', error);
      throw new Error('Failed to create client');
    }
  }

  static async update(id: string, updateData: Partial<{
    client_name: string;
    redirect_uris: string[];
    grant_types: string[];
    response_types: string[];
    scope: string;
    token_endpoint_auth_method: string;
  }>): Promise<Client | undefined> {
    try {
      const db = await Client.getDatabase();
      
      const updateFields = [];
      const updateValues = [];
      let paramCount = 1;

      Object.entries(updateData).forEach(([key, value]) => {
        if (value !== undefined) {
          updateFields.push(`${key} = $${paramCount}`);
          updateValues.push(value);
          paramCount++;
        }
      });

      if (updateFields.length === 0) {
        return await Client.findById(id);
      }

      updateFields.push(`updated_at = NOW()`);
      updateValues.push(id);

      const query = `
        UPDATE clients 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramCount}
        RETURNING *
      `;

      const result = await db.query(query, updateValues);

      if (result.rows.length === 0) {
        return undefined;
      }

      return new Client(result.rows[0]);
    } catch (error) {
      logger.error('Error updating client:', error);
      throw new Error('Failed to update client');
    }
  }

  static async delete(id: string): Promise<boolean> {
    try {
      const db = await Client.getDatabase();
      const result = await db.query(
        'DELETE FROM clients WHERE id = $1',
        [id]
      );

      return (result.rowCount || 0) > 0;
    } catch (error) {
      logger.error('Error deleting client:', error);
      return false;
    }
  }

  // Convert to OIDC Provider format
  toOIDCFormat() {
    return {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_types: this.grantTypes,
      redirect_uris: this.redirectUris,
      response_types: this.responseTypes,
      scope: this.scope,
      token_endpoint_auth_method: this.tokenEndpointAuthMethod,
    };
  }

  private static pool: Pool;

  private static async getDatabase(): Promise<Pool> {
    if (!this.pool) {
      this.pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'identity_server',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
      });
    }
    return this.pool;
  }
}
