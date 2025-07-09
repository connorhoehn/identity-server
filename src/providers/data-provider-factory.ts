import { IDataProvider } from '../interfaces/data-provider.js';
import { PostgreSQLDataProvider } from './postgres-data-provider.js';
import { DynamoDBDataProvider } from './dynamodb-data-provider.js';
import { logger } from '../utils/logger.js';

export type DataProviderType = 'postgresql' | 'dynamodb';

export class DataProviderFactory {
  private static instance: IDataProvider | null = null;

  static getProvider(): IDataProvider {
    if (!this.instance) {
      this.instance = this.createProvider();
    }
    return this.instance;
  }

  static async disconnect(): Promise<void> {
    if (this.instance) {
      await this.instance.disconnect();
      this.instance = null;
    }
  }

  private static createProvider(): IDataProvider {
    const providerType = (process.env.DATA_PROVIDER || 'postgresql').toLowerCase() as DataProviderType;
    
    logger.info(`Creating data provider: ${providerType}`);

    switch (providerType) {
      case 'postgresql':
        return new PostgreSQLDataProvider();
      
      case 'dynamodb':
        return new DynamoDBDataProvider();
      
      default:
        logger.warn(`Unknown data provider type: ${providerType}, falling back to PostgreSQL`);
        return new PostgreSQLDataProvider();
    }
  }

  static async initialize(): Promise<void> {
    const provider = this.getProvider();
    await provider.connect();
    logger.info('Data provider initialized successfully');
  }
}

// Export convenience function
export function getDataProvider(): IDataProvider {
  return DataProviderFactory.getProvider();
}
