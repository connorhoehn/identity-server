import * as AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { 
  IDataProvider, 
  UserPoolData, 
  UserData, 
  ClientData, 
  GroupData,
  MfaDeviceData 
} from '../interfaces/data-provider.js';
import { logger } from '../utils/logger.js';

export class DynamoDBDataProvider implements IDataProvider {
  private dynamodb: AWS.DynamoDB.DocumentClient;
  private isConnected = false;

  // Table names
  private readonly tables = {
    userPools: process.env.DYNAMODB_USER_POOLS_TABLE || 'identity-server-user-pools',
    users: process.env.DYNAMODB_USERS_TABLE || 'identity-server-users',
    clients: process.env.DYNAMODB_CLIENTS_TABLE || 'identity-server-clients',
    groups: process.env.DYNAMODB_GROUPS_TABLE || 'identity-server-groups',
  };

  constructor() {
    // Configure DynamoDB for local development or AWS
    const config: any = {
      region: process.env.AWS_REGION || 'us-east-1',
    };

    // Use DynamoDB Local if specified
    if (process.env.DYNAMODB_ENDPOINT) {
      config.endpoint = process.env.DYNAMODB_ENDPOINT;
      config.accessKeyId = 'local';
      config.secretAccessKey = 'local';
    }

    this.dynamodb = new AWS.DynamoDB.DocumentClient(config);
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      await this.createTables();
      this.isConnected = true;
      logger.info('DynamoDB data provider connected');
    } catch (error) {
      logger.error('Failed to connect DynamoDB data provider:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    // DynamoDB doesn't require explicit disconnection
    this.isConnected = false;
    logger.info('DynamoDB data provider disconnected');
  }

  private async createTables(): Promise<void> {
    const dynamodb = new AWS.DynamoDB({
      region: process.env.AWS_REGION || 'us-east-1',
      endpoint: process.env.DYNAMODB_ENDPOINT,
      accessKeyId: process.env.DYNAMODB_ENDPOINT ? 'local' : undefined,
      secretAccessKey: process.env.DYNAMODB_ENDPOINT ? 'local' : undefined,
    });

    try {
      // Create User Pools table
      await this.createTableIfNotExists(dynamodb, {
        TableName: this.tables.userPools,
        KeySchema: [
          { AttributeName: 'poolId', KeyType: 'HASH' }
        ],
        AttributeDefinitions: [
          { AttributeName: 'poolId', AttributeType: 'S' },
          { AttributeName: 'clientId', AttributeType: 'S' }
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'ClientIdIndex',
            KeySchema: [{ AttributeName: 'clientId', KeyType: 'HASH' }],
            Projection: { ProjectionType: 'ALL' },
          }
        ],
        BillingMode: 'PAY_PER_REQUEST',
      });

      // Create Users table
      await this.createTableIfNotExists(dynamodb, {
        TableName: this.tables.users,
        KeySchema: [
          { AttributeName: 'poolId', KeyType: 'HASH' },
          { AttributeName: 'userId', KeyType: 'RANGE' }
        ],
        AttributeDefinitions: [
          { AttributeName: 'poolId', AttributeType: 'S' },
          { AttributeName: 'userId', AttributeType: 'S' },
          { AttributeName: 'email', AttributeType: 'S' }
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'EmailIndex',
            KeySchema: [
              { AttributeName: 'poolId', KeyType: 'HASH' },
              { AttributeName: 'email', KeyType: 'RANGE' }
            ],
            Projection: { ProjectionType: 'ALL' },
          }
        ],
        BillingMode: 'PAY_PER_REQUEST',
      });

      // Create Clients table
      await this.createTableIfNotExists(dynamodb, {
        TableName: this.tables.clients,
        KeySchema: [
          { AttributeName: 'clientId', KeyType: 'HASH' }
        ],
        AttributeDefinitions: [
          { AttributeName: 'clientId', AttributeType: 'S' },
          { AttributeName: 'poolId', AttributeType: 'S' }
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'PoolIdIndex',
            KeySchema: [{ AttributeName: 'poolId', KeyType: 'HASH' }],
            Projection: { ProjectionType: 'ALL' },
          }
        ],
        BillingMode: 'PAY_PER_REQUEST',
      });

      // Create Groups table
      await this.createTableIfNotExists(dynamodb, {
        TableName: this.tables.groups,
        KeySchema: [
          { AttributeName: 'poolId', KeyType: 'HASH' },
          { AttributeName: 'groupId', KeyType: 'RANGE' }
        ],
        AttributeDefinitions: [
          { AttributeName: 'poolId', AttributeType: 'S' },
          { AttributeName: 'groupId', AttributeType: 'S' }
        ],
        BillingMode: 'PAY_PER_REQUEST',
      });

      logger.info('DynamoDB tables created/verified successfully');
    } catch (error) {
      logger.error('Failed to create DynamoDB tables:', error);
      throw error;
    }
  }

  private async createTableIfNotExists(dynamodb: AWS.DynamoDB, tableConfig: AWS.DynamoDB.CreateTableInput): Promise<void> {
    try {
      await dynamodb.describeTable({ TableName: tableConfig.TableName }).promise();
      logger.info(`Table ${tableConfig.TableName} already exists`);
    } catch (error: any) {
      if (error.code === 'ResourceNotFoundException') {
        logger.info(`Creating table ${tableConfig.TableName}`);
        await dynamodb.createTable(tableConfig).promise();
        
        // Wait for table to be active
        await dynamodb.waitFor('tableExists', { TableName: tableConfig.TableName }).promise();
        logger.info(`Table ${tableConfig.TableName} created successfully`);
      } else {
        throw error;
      }
    }
  }

  // User Pool operations
  async createUserPool(pool: Omit<UserPoolData, 'createdAt' | 'updatedAt'>): Promise<UserPoolData> {
    const now = new Date();
    const item: UserPoolData = {
      ...pool,
      createdAt: now,
      updatedAt: now,
    };

    await this.dynamodb.put({
      TableName: this.tables.userPools,
      Item: item,
      ConditionExpression: 'attribute_not_exists(poolId)',
    }).promise();

    return item;
  }

  async getUserPool(poolId: string): Promise<UserPoolData | null> {
    const result = await this.dynamodb.get({
      TableName: this.tables.userPools,
      Key: { poolId },
    }).promise();

    return result.Item as UserPoolData || null;
  }

  async getUserPoolByClientId(clientId: string): Promise<UserPoolData | null> {
    const result = await this.dynamodb.query({
      TableName: this.tables.userPools,
      IndexName: 'ClientIdIndex',
      KeyConditionExpression: 'clientId = :clientId',
      ExpressionAttributeValues: {
        ':clientId': clientId,
      },
    }).promise();

    return result.Items?.[0] as UserPoolData || null;
  }

  async listUserPools(): Promise<UserPoolData[]> {
    const result = await this.dynamodb.scan({
      TableName: this.tables.userPools,
    }).promise();

    return (result.Items as UserPoolData[]) || [];
  }

  async updateUserPool(poolId: string, updates: Partial<UserPoolData>): Promise<UserPoolData> {
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    if (updates.poolName !== undefined) {
      updateExpressions.push('#poolName = :poolName');
      expressionAttributeNames['#poolName'] = 'poolName';
      expressionAttributeValues[':poolName'] = updates.poolName;
    }

    if (updates.customAttributes !== undefined) {
      updateExpressions.push('#customAttributes = :customAttributes');
      expressionAttributeNames['#customAttributes'] = 'customAttributes';
      expressionAttributeValues[':customAttributes'] = updates.customAttributes;
    }

    if (updates.settings !== undefined) {
      updateExpressions.push('#settings = :settings');
      expressionAttributeNames['#settings'] = 'settings';
      expressionAttributeValues[':settings'] = updates.settings;
    }

    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date();

    const result = await this.dynamodb.update({
      TableName: this.tables.userPools,
      Key: { poolId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
      ConditionExpression: 'attribute_exists(poolId)',
    }).promise();

    return result.Attributes as UserPoolData;
  }

  async deleteUserPool(poolId: string): Promise<void> {
    await this.dynamodb.delete({
      TableName: this.tables.userPools,
      Key: { poolId },
      ConditionExpression: 'attribute_exists(poolId)',
    }).promise();
  }

  // User operations
  async createUser(user: Omit<UserData, 'userId' | 'createdAt' | 'updatedAt'>): Promise<UserData> {
    const userId = uuidv4();
    const now = new Date();
    const item: UserData = {
      ...user,
      userId,
      createdAt: now,
      updatedAt: now,
    };

    await this.dynamodb.put({
      TableName: this.tables.users,
      Item: item,
      ConditionExpression: 'attribute_not_exists(userId)',
    }).promise();

    return item;
  }

  async getUser(poolId: string, userId: string): Promise<UserData | null> {
    const result = await this.dynamodb.get({
      TableName: this.tables.users,
      Key: { poolId, userId },
    }).promise();

    return result.Item as UserData || null;
  }

  async getUserByEmail(poolId: string, email: string): Promise<UserData | null> {
    const result = await this.dynamodb.query({
      TableName: this.tables.users,
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'poolId = :poolId AND email = :email',
      ExpressionAttributeValues: {
        ':poolId': poolId,
        ':email': email,
      },
    }).promise();

    return result.Items?.[0] as UserData || null;
  }

  async listUsers(poolId: string, limit = 50, nextToken?: string): Promise<{ users: UserData[], nextToken?: string }> {
    const params: AWS.DynamoDB.DocumentClient.QueryInput = {
      TableName: this.tables.users,
      KeyConditionExpression: 'poolId = :poolId',
      ExpressionAttributeValues: {
        ':poolId': poolId,
      },
      Limit: limit,
    };

    if (nextToken) {
      params.ExclusiveStartKey = JSON.parse(nextToken);
    }

    const result = await this.dynamodb.query(params).promise();

    return {
      users: (result.Items as UserData[]) || [],
      nextToken: result.LastEvaluatedKey ? JSON.stringify(result.LastEvaluatedKey) : undefined,
    };
  }

  async updateUser(poolId: string, userId: string, updates: Partial<UserData>): Promise<UserData> {
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    const updateableFields = [
      'email', 'emailVerified', 'passwordHash', 'name', 'givenName', 
      'familyName', 'nickname', 'picture', 'website', 'customAttributes',
      'groups', 'status', 'mfaEnabled', 'lastLogin'
    ];

    for (const field of updateableFields) {
      if (updates[field as keyof UserData] !== undefined) {
        updateExpressions.push(`#${field} = :${field}`);
        expressionAttributeNames[`#${field}`] = field;
        expressionAttributeValues[`:${field}`] = updates[field as keyof UserData];
      }
    }

    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date();

    const result = await this.dynamodb.update({
      TableName: this.tables.users,
      Key: { poolId, userId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
      ConditionExpression: 'attribute_exists(userId)',
    }).promise();

    return result.Attributes as UserData;
  }

  async deleteUser(poolId: string, userId: string): Promise<void> {
    await this.dynamodb.delete({
      TableName: this.tables.users,
      Key: { poolId, userId },
      ConditionExpression: 'attribute_exists(userId)',
    }).promise();
  }

  // Client operations
  async createClient(client: Omit<ClientData, 'createdAt' | 'updatedAt'>): Promise<ClientData> {
    const now = new Date();
    const item: ClientData = {
      ...client,
      createdAt: now,
      updatedAt: now,
    };

    await this.dynamodb.put({
      TableName: this.tables.clients,
      Item: item,
      ConditionExpression: 'attribute_not_exists(clientId)',
    }).promise();

    return item;
  }

  async getClient(clientId: string): Promise<ClientData | null> {
    const result = await this.dynamodb.get({
      TableName: this.tables.clients,
      Key: { clientId },
    }).promise();

    return result.Item as ClientData || null;
  }

  async listClients(poolId?: string): Promise<ClientData[]> {
    if (poolId) {
      const result = await this.dynamodb.query({
        TableName: this.tables.clients,
        IndexName: 'PoolIdIndex',
        KeyConditionExpression: 'poolId = :poolId',
        ExpressionAttributeValues: {
          ':poolId': poolId,
        },
      }).promise();

      return (result.Items as ClientData[]) || [];
    } else {
      const result = await this.dynamodb.scan({
        TableName: this.tables.clients,
      }).promise();

      return (result.Items as ClientData[]) || [];
    }
  }

  async updateClient(clientId: string, updates: Partial<ClientData>): Promise<ClientData> {
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    const updateableFields = [
      'clientSecret', 'clientName', 'redirectUris', 'postLogoutRedirectUris',
      'responseTypes', 'grantTypes', 'scope', 'tokenEndpointAuthMethod',
      'applicationType', 'settings'
    ];

    for (const field of updateableFields) {
      if (updates[field as keyof ClientData] !== undefined) {
        updateExpressions.push(`#${field} = :${field}`);
        expressionAttributeNames[`#${field}`] = field;
        expressionAttributeValues[`:${field}`] = updates[field as keyof ClientData];
      }
    }

    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date();

    const result = await this.dynamodb.update({
      TableName: this.tables.clients,
      Key: { clientId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
      ConditionExpression: 'attribute_exists(clientId)',
    }).promise();

    return result.Attributes as ClientData;
  }

  async deleteClient(clientId: string): Promise<void> {
    await this.dynamodb.delete({
      TableName: this.tables.clients,
      Key: { clientId },
      ConditionExpression: 'attribute_exists(clientId)',
    }).promise();
  }

  // Group operations
  async createGroup(group: Omit<GroupData, 'groupId' | 'createdAt' | 'updatedAt'>): Promise<GroupData> {
    const groupId = uuidv4();
    const now = new Date();
    const item: GroupData = {
      ...group,
      groupId,
      createdAt: now,
      updatedAt: now,
    };

    await this.dynamodb.put({
      TableName: this.tables.groups,
      Item: item,
      ConditionExpression: 'attribute_not_exists(groupId)',
    }).promise();

    return item;
  }

  async getGroup(poolId: string, groupId: string): Promise<GroupData | null> {
    const result = await this.dynamodb.get({
      TableName: this.tables.groups,
      Key: { poolId, groupId },
    }).promise();

    return result.Item as GroupData || null;
  }

  async listGroups(poolId: string): Promise<GroupData[]> {
    const result = await this.dynamodb.query({
      TableName: this.tables.groups,
      KeyConditionExpression: 'poolId = :poolId',
      ExpressionAttributeValues: {
        ':poolId': poolId,
      },
    }).promise();

    return (result.Items as GroupData[]) || [];
  }

  async updateGroup(poolId: string, groupId: string, updates: Partial<GroupData>): Promise<GroupData> {
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    if (updates.groupName !== undefined) {
      updateExpressions.push('#groupName = :groupName');
      expressionAttributeNames['#groupName'] = 'groupName';
      expressionAttributeValues[':groupName'] = updates.groupName;
    }

    if (updates.description !== undefined) {
      updateExpressions.push('#description = :description');
      expressionAttributeNames['#description'] = 'description';
      expressionAttributeValues[':description'] = updates.description;
    }

    if (updates.permissions !== undefined) {
      updateExpressions.push('#permissions = :permissions');
      expressionAttributeNames['#permissions'] = 'permissions';
      expressionAttributeValues[':permissions'] = updates.permissions;
    }

    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date();

    const result = await this.dynamodb.update({
      TableName: this.tables.groups,
      Key: { poolId, groupId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
      ConditionExpression: 'attribute_exists(groupId)',
    }).promise();

    return result.Attributes as GroupData;
  }

  async deleteGroup(poolId: string, groupId: string): Promise<void> {
    // First, remove the group from all users
    const users = await this.getGroupUsers(poolId, groupId);
    
    const deletePromises = users.map(user => 
      this.removeUserFromGroup(poolId, user.userId, groupId)
    );
    
    await Promise.all(deletePromises);

    // Then delete the group
    await this.dynamodb.delete({
      TableName: this.tables.groups,
      Key: { poolId, groupId },
      ConditionExpression: 'attribute_exists(groupId)',
    }).promise();
  }

  // User-Group operations
  async addUserToGroup(poolId: string, userId: string, groupId: string): Promise<void> {
    const user = await this.getUser(poolId, userId);
    if (!user) {
      throw new Error(`User not found: ${userId} in pool ${poolId}`);
    }

    if (!user.groups.includes(groupId)) {
      await this.updateUser(poolId, userId, {
        groups: [...user.groups, groupId]
      });
    }
  }

  async removeUserFromGroup(poolId: string, userId: string, groupId: string): Promise<void> {
    const user = await this.getUser(poolId, userId);
    if (!user) {
      throw new Error(`User not found: ${userId} in pool ${poolId}`);
    }

    if (user.groups.includes(groupId)) {
      await this.updateUser(poolId, userId, {
        groups: user.groups.filter(g => g !== groupId)
      });
    }
  }

  async getUserGroups(poolId: string, userId: string): Promise<GroupData[]> {
    const user = await this.getUser(poolId, userId);
    if (!user) {
      return [];
    }

    const groupPromises = user.groups.map(groupId => 
      this.getGroup(poolId, groupId)
    );

    const groups = await Promise.all(groupPromises);
    return groups.filter(group => group !== null) as GroupData[];
  }

  async getGroupUsers(poolId: string, groupId: string): Promise<UserData[]> {
    const result = await this.dynamodb.query({
      TableName: this.tables.users,
      KeyConditionExpression: 'poolId = :poolId',
      FilterExpression: 'contains(#groups, :groupId)',
      ExpressionAttributeNames: {
        '#groups': 'groups',
      },
      ExpressionAttributeValues: {
        ':poolId': poolId,
        ':groupId': groupId,
      },
    }).promise();

    return (result.Items as UserData[]) || [];
  }

  // MFA Device operations (stubs - not implemented for DynamoDB yet)
  async createMfaDevice(device: Omit<MfaDeviceData, 'deviceId' | 'createdAt' | 'updatedAt'>): Promise<MfaDeviceData> {
    throw new Error('MFA devices not implemented for DynamoDB provider yet');
  }

  async getMfaDevice(poolId: string, userId: string, deviceId: string): Promise<MfaDeviceData | null> {
    throw new Error('MFA devices not implemented for DynamoDB provider yet');
  }

  async listUserMfaDevices(poolId: string, userId: string): Promise<MfaDeviceData[]> {
    throw new Error('MFA devices not implemented for DynamoDB provider yet');
  }

  async updateMfaDevice(poolId: string, userId: string, deviceId: string, updates: Partial<MfaDeviceData>): Promise<MfaDeviceData> {
    throw new Error('MFA devices not implemented for DynamoDB provider yet');
  }

  async deleteMfaDevice(poolId: string, userId: string, deviceId: string): Promise<void> {
    throw new Error('MFA devices not implemented for DynamoDB provider yet');
  }

  async verifyMfaDevice(poolId: string, userId: string, deviceId: string): Promise<void> {
    throw new Error('MFA devices not implemented for DynamoDB provider yet');
  }

  async updateUserMfaStatus(poolId: string, userId: string, enabled: boolean): Promise<void> {
    throw new Error('MFA user status update not implemented for DynamoDB provider yet');
  }
}
