import AWS from 'aws-sdk';

export class DynamoDBService {
  private static instance: DynamoDBService;
  private dynamodb: AWS.DynamoDB.DocumentClient;

  private constructor() {
    // Configure for DynamoDB Local
    AWS.config.update({
      region: process.env.DYNAMODB_REGION || 'us-east-1',
      accessKeyId: process.env.DYNAMODB_ACCESS_KEY_ID || 'dummy',
      secretAccessKey: process.env.DYNAMODB_SECRET_ACCESS_KEY || 'dummy',
    } as any);

    // Set endpoint separately for DynamoDB Local
    if (process.env.DYNAMODB_ENDPOINT) {
      (AWS.config as any).endpoint = process.env.DYNAMODB_ENDPOINT;
    }

    this.dynamodb = new AWS.DynamoDB.DocumentClient();
  }

  static getInstance(): DynamoDBService {
    if (!DynamoDBService.instance) {
      DynamoDBService.instance = new DynamoDBService();
    }
    return DynamoDBService.instance;
  }

  async createTable(tableName: string, keySchema: any, attributeDefinitions: any): Promise<void> {
    const dynamodb = new AWS.DynamoDB();
    
    const params = {
      TableName: tableName,
      KeySchema: keySchema,
      AttributeDefinitions: attributeDefinitions,
      BillingMode: 'PAY_PER_REQUEST',
    };

    try {
      await dynamodb.createTable(params).promise();
      console.log(`Table ${tableName} created successfully`);
    } catch (error: any) {
      if (error.code === 'ResourceInUseException') {
        console.log(`Table ${tableName} already exists`);
      } else {
        throw error;
      }
    }
  }

  async put(tableName: string, id: string, item: any): Promise<void> {
    const params = {
      TableName: tableName,
      Item: { id, ...item },
    };
    await this.dynamodb.put(params).promise();
  }

  async get(tableName: string, id: string): Promise<any> {
    const params = {
      TableName: tableName,
      Key: { id },
    };
    const result = await this.dynamodb.get(params).promise();
    return result.Item || null;
  }

  async scan(tableName: string): Promise<any[]> {
    const params = {
      TableName: tableName,
    };
    const result = await this.dynamodb.scan(params).promise();
    return result.Items || [];
  }

  async query(tableName: string, keyCondition: any, indexName?: string): Promise<any[]> {
    const params: any = {
      TableName: tableName,
      KeyConditionExpression: keyCondition.expression,
      ExpressionAttributeValues: keyCondition.values,
    };

    if (indexName) {
      params.IndexName = indexName;
    }

    const result = await this.dynamodb.query(params).promise();
    return result.Items || [];
  }

  async delete(tableName: string, id: string): Promise<void> {
    const params = {
      TableName: tableName,
      Key: { id },
    };
    await this.dynamodb.delete(params).promise();
  }

  async update(tableName: string, id: string, updates: any): Promise<any> {
    const updateExpression = Object.keys(updates)
      .map(key => `#${key} = :${key}`)
      .join(', ');

    const expressionAttributeNames = Object.keys(updates).reduce((acc, key) => {
      acc[`#${key}`] = key;
      return acc;
    }, {} as any);

    const expressionAttributeValues = Object.keys(updates).reduce((acc, key) => {
      acc[`:${key}`] = updates[key];
      return acc;
    }, {} as any);

    const params = {
      TableName: tableName,
      Key: { id },
      UpdateExpression: `SET ${updateExpression}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    };

    const result = await this.dynamodb.update(params).promise();
    return result.Attributes;
  }

  // Helper methods for user pool operations
  async putUserInPool(clientId: string, userId: string, userData: any): Promise<void> {
    const params = {
      TableName: 'user_pools',
      Item: {
        client_id: clientId,
        user_id: userId,
        ...userData,
      },
    };
    await this.dynamodb.put(params).promise();
  }

  async getUserFromPool(clientId: string, userId: string): Promise<any> {
    const params = {
      TableName: 'user_pools',
      Key: {
        client_id: clientId,
        user_id: userId,
      },
    };
    const result = await this.dynamodb.get(params).promise();
    return result.Item || null;
  }

  async getUserByEmailFromPool(clientId: string, email: string): Promise<any> {
    const params = {
      TableName: 'user_pools',
      IndexName: 'client-email-index',
      KeyConditionExpression: 'client_id = :clientId AND email = :email',
      ExpressionAttributeValues: {
        ':clientId': clientId,
        ':email': email,
      },
    };
    const result = await this.dynamodb.query(params).promise();
    return result.Items && result.Items.length > 0 ? result.Items[0] : null;
  }

  async getAllUsersFromPool(clientId: string): Promise<any[]> {
    const params = {
      TableName: 'user_pools',
      KeyConditionExpression: 'client_id = :clientId',
      ExpressionAttributeValues: {
        ':clientId': clientId,
      },
    };
    const result = await this.dynamodb.query(params).promise();
    return result.Items || [];
  }

  async updateUserInPool(clientId: string, userId: string, updates: any): Promise<any> {
    const updateExpression = Object.keys(updates)
      .map(key => `#${key} = :${key}`)
      .join(', ');

    const expressionAttributeNames = Object.keys(updates).reduce((acc, key) => {
      acc[`#${key}`] = key;
      return acc;
    }, {} as any);

    const expressionAttributeValues = Object.keys(updates).reduce((acc, key) => {
      acc[`:${key}`] = updates[key];
      return acc;
    }, {} as any);

    const params = {
      TableName: 'user_pools',
      Key: {
        client_id: clientId,
        user_id: userId,
      },
      UpdateExpression: `SET ${updateExpression}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    };

    const result = await this.dynamodb.update(params).promise();
    return result.Attributes;
  }

  async deleteUserFromPool(clientId: string, userId: string): Promise<void> {
    const params = {
      TableName: 'user_pools',
      Key: {
        client_id: clientId,
        user_id: userId,
      },
    };
    await this.dynamodb.delete(params).promise();
  }

  // Client operations
  async putClient(clientId: string, clientData: any): Promise<void> {
    const params = {
      TableName: 'clients',
      Item: {
        client_id: clientId,
        ...clientData,
      },
    };
    await this.dynamodb.put(params).promise();
  }

  async getClient(clientId: string): Promise<any> {
    const params = {
      TableName: 'clients',
      Key: { client_id: clientId },
    };
    const result = await this.dynamodb.get(params).promise();
    return result.Item || null;
  }

  async getAllClients(): Promise<any[]> {
    const params = { TableName: 'clients' };
    const result = await this.dynamodb.scan(params).promise();
    return result.Items || [];
  }

  // Initialize required tables
  async initializeTables(): Promise<void> {
    const dynamodb = new AWS.DynamoDB();
    
    try {
      // Clients table - stores OIDC client configurations and user pool settings
      await this.createTable('clients', 
        [{ AttributeName: 'client_id', KeyType: 'HASH' }],
        [{ AttributeName: 'client_id', AttributeType: 'S' }]
      );

      // User pools table - isolated user storage per client
      await this.createTable('user_pools',
        [
          { AttributeName: 'client_id', KeyType: 'HASH' },
          { AttributeName: 'user_id', KeyType: 'RANGE' }
        ],
        [
          { AttributeName: 'client_id', AttributeType: 'S' },
          { AttributeName: 'user_id', AttributeType: 'S' },
          { AttributeName: 'email', AttributeType: 'S' }
        ]
      );

      // Add Global Secondary Index for email lookups within a client pool
      try {
        await dynamodb.updateTable({
          TableName: 'user_pools',
          GlobalSecondaryIndexUpdates: [
            {
              Create: {
                IndexName: 'client-email-index',
                KeySchema: [
                  { AttributeName: 'client_id', KeyType: 'HASH' },
                  { AttributeName: 'email', KeyType: 'RANGE' }
                ],
                Projection: { ProjectionType: 'ALL' },
                ProvisionedThroughput: {
                  ReadCapacityUnits: 5,
                  WriteCapacityUnits: 5
                }
              }
            }
          ]
        }).promise();
        console.log('GSI client-email-index created successfully');
      } catch (error: any) {
        if (error.code !== 'ValidationException' || !error.message.includes('already exists')) {
          console.error('Error creating GSI:', error);
        }
      }

      // User groups table - role/group management per client pool
      await this.createTable('user_groups',
        [
          { AttributeName: 'client_id', KeyType: 'HASH' },
          { AttributeName: 'group_id', KeyType: 'RANGE' }
        ],
        [
          { AttributeName: 'client_id', AttributeType: 'S' },
          { AttributeName: 'group_id', AttributeType: 'S' }
        ]
      );

      // User group memberships - many-to-many relationship
      await this.createTable('user_group_memberships',
        [
          { AttributeName: 'client_id', KeyType: 'HASH' },
          { AttributeName: 'membership_id', KeyType: 'RANGE' }
        ],
        [
          { AttributeName: 'client_id', AttributeType: 'S' },
          { AttributeName: 'membership_id', AttributeType: 'S' },
          { AttributeName: 'user_id', AttributeType: 'S' },
          { AttributeName: 'group_id', AttributeType: 'S' }
        ]
      );

      console.log('All tables initialized successfully');
    } catch (error) {
      console.error('Error initializing tables:', error);
      throw error;
    }
  }
}
