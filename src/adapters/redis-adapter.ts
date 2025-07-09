import { createClient } from 'redis';
import { logger } from '../utils/logger.js';

class RedisAdapter {
  private static client: any;
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  static async connect() {
    if (!this.client) {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6377'
      });
      
      this.client.on('error', (err: Error) => {
        logger.error('Redis Client Error', err);
      });
      
      await this.client.connect();
      logger.info('Connected to Redis');
    }
    return this.client;
  }

  key(id: string) {
    return `oidc:${this.name}:${id}`;
  }

  async destroy(id: string) {
    const client = await RedisAdapter.connect();
    const key = this.key(id);
    await client.del(key);
  }

  async consume(id: string) {
    const client = await RedisAdapter.connect();
    const key = this.key(id);
    await client.hSet(key, { consumed: Math.floor(Date.now() / 1000) });
  }

  async find(id: string) {
    const client = await RedisAdapter.connect();
    const key = this.key(id);
    const data = await client.hGetAll(key);
    
    if (!data || !data.payload) return undefined;
    
    const payload = JSON.parse(data.payload);
    if (data.consumed) {
      payload.consumed = parseInt(data.consumed, 10);
    }
    
    return payload;
  }

  async findByUserCode(userCode: string) {
    const client = await RedisAdapter.connect();
    const key = `oidc:${this.name}:userCode:${userCode}`;
    const id = await client.get(key);
    return this.find(id);
  }

  async findByUid(uid: string) {
    const client = await RedisAdapter.connect();
    const key = `oidc:${this.name}:uid:${uid}`;
    const id = await client.get(key);
    return this.find(id);
  }

  async upsert(id: string, payload: any, expiresIn: number) {
    const client = await RedisAdapter.connect();
    const key = this.key(id);
    
    const multi = client.multi();
    multi.hSet(key, { payload: JSON.stringify(payload) });
    
    if (expiresIn) {
      multi.expire(key, expiresIn);
    }
    
    if (payload.userCode) {
      const userCodeKey = `oidc:${this.name}:userCode:${payload.userCode}`;
      multi.set(userCodeKey, id);
      if (expiresIn) {
        multi.expire(userCodeKey, expiresIn);
      }
    }
    
    if (payload.uid) {
      const uidKey = `oidc:${this.name}:uid:${payload.uid}`;
      multi.set(uidKey, id);
      if (expiresIn) {
        multi.expire(uidKey, expiresIn);
      }
    }
    
    await multi.exec();
  }

  async revokeByGrantId(grantId: string) {
    const client = await RedisAdapter.connect();
    const keys = await client.keys(`oidc:*:${grantId}`);
    if (keys.length) await client.del(...keys);
  }
}

export { RedisAdapter };
