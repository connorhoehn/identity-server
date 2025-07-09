import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

interface UserData {
  id: string;
  email: string;
  password_hash: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  nickname?: string;
  picture?: string;
  profile?: string;
  website?: string;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

export class Account {
  public accountId: string;
  public profile: any;

  constructor(id: string, profile: any) {
    this.accountId = id;
    this.profile = profile;
  }

  static async findAccount(ctx: any, id: string, token?: any) {
    try {
      const db = await Account.getDatabase();
      const result = await db.query(
        'SELECT * FROM users WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return undefined;
      }

      const user = result.rows[0];
      return new Account(user.id, {
        sub: user.id,
        email: user.email,
        email_verified: user.email_verified,
        given_name: user.given_name,
        family_name: user.family_name,
        name: user.name || `${user.given_name || ''} ${user.family_name || ''}`.trim(),
        nickname: user.nickname,
        picture: user.picture,
        profile: user.profile,
        website: user.website,
        updated_at: Math.floor(user.updated_at.getTime() / 1000),
      });
    } catch (error) {
      logger.error('Error finding account:', error);
      return undefined;
    }
  }

  static async findByEmail(email: string): Promise<Account | undefined> {
    try {
      const db = await Account.getDatabase();
      const result = await db.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        return undefined;
      }

      const user = result.rows[0];
      return new Account(user.id, {
        sub: user.id,
        email: user.email,
        email_verified: user.email_verified,
        given_name: user.given_name,
        family_name: user.family_name,
        name: user.name || `${user.given_name || ''} ${user.family_name || ''}`.trim(),
        nickname: user.nickname,
        picture: user.picture,
        profile: user.profile,
        website: user.website,
        password_hash: user.password_hash,
      });
    } catch (error) {
      logger.error('Error finding account by email:', error);
      return undefined;
    }
  }

  static async authenticate(email: string, password: string): Promise<Account | null> {
    try {
      const account = await Account.findByEmail(email);
      if (!account || !account.profile.password_hash) {
        return null;
      }

      const isValid = await bcrypt.compare(password, account.profile.password_hash);
      if (!isValid) {
        return null;
      }

      // Remove password hash from profile for security
      delete account.profile.password_hash;
      return account;
    } catch (error) {
      logger.error('Error authenticating account:', error);
      return null;
    }
  }

  static async create(userData: {
    email: string;
    password: string;
    given_name?: string;
    family_name?: string;
    nickname?: string;
  }): Promise<Account> {
    try {
      const db = await Account.getDatabase();
      const id = uuidv4();
      const passwordHash = await bcrypt.hash(userData.password, 10);

      const result = await db.query(
        `INSERT INTO users (id, email, password_hash, given_name, family_name, nickname, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         RETURNING *`,
        [
          id,
          userData.email,
          passwordHash,
          userData.given_name,
          userData.family_name,
          userData.nickname,
          false, // email_verified
        ]
      );

      const user = result.rows[0];
      return new Account(user.id, {
        sub: user.id,
        email: user.email,
        email_verified: user.email_verified,
        given_name: user.given_name,
        family_name: user.family_name,
        name: `${user.given_name || ''} ${user.family_name || ''}`.trim(),
        nickname: user.nickname,
      });
    } catch (error) {
      logger.error('Error creating account:', error);
      throw new Error('Failed to create account');
    }
  }

  static async findAll(): Promise<Account[]> {
    try {
      const db = await Account.getDatabase();
      const result = await db.query(
        'SELECT * FROM users ORDER BY created_at DESC'
      );

      return result.rows.map(user => {
        const account = new Account(user.id, {
          sub: user.id,
          email: user.email,
          email_verified: user.email_verified,
          given_name: user.given_name,
          family_name: user.family_name,
          name: user.name || `${user.given_name || ''} ${user.family_name || ''}`.trim(),
          nickname: user.nickname,
          picture: user.picture,
          profile: user.profile,
          website: user.website,
          created_at: user.created_at,
          updated_at: user.updated_at,
        });
        // Add raw user data for admin interface
        (account as any).id = user.id;
        (account as any).email = user.email;
        (account as any).created_at = user.created_at;
        (account as any).updated_at = user.updated_at;
        (account as any).is_active = true; // Default to active
        return account;
      });
    } catch (error) {
      logger.error('Error finding all accounts:', error);
      return [];
    }
  }

  static async update(id: string, userData: {
    email?: string;
    password?: string;
    given_name?: string;
    family_name?: string;
    nickname?: string;
    picture?: string;
    profile?: string;
    website?: string;
  }): Promise<Account> {
    try {
      const db = await Account.getDatabase();
      
      // Build dynamic update query
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (userData.email !== undefined) {
        updateFields.push(`email = $${paramIndex++}`);
        values.push(userData.email);
      }

      if (userData.password) {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(userData.password, salt);
        updateFields.push(`password_hash = $${paramIndex++}`);
        values.push(passwordHash);
      }

      if (userData.given_name !== undefined) {
        updateFields.push(`given_name = $${paramIndex++}`);
        values.push(userData.given_name);
      }

      if (userData.family_name !== undefined) {
        updateFields.push(`family_name = $${paramIndex++}`);
        values.push(userData.family_name);
      }

      if (userData.nickname !== undefined) {
        updateFields.push(`nickname = $${paramIndex++}`);
        values.push(userData.nickname);
      }

      if (userData.picture !== undefined) {
        updateFields.push(`picture = $${paramIndex++}`);
        values.push(userData.picture);
      }

      if (userData.profile !== undefined) {
        updateFields.push(`profile = $${paramIndex++}`);
        values.push(userData.profile);
      }

      if (userData.website !== undefined) {
        updateFields.push(`website = $${paramIndex++}`);
        values.push(userData.website);
      }

      updateFields.push(`updated_at = $${paramIndex++}`);
      values.push(new Date());

      values.push(id); // Add ID for WHERE clause

      const query = `
        UPDATE users 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result = await db.query(query, values);

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = result.rows[0];
      return new Account(user.id, {
        sub: user.id,
        email: user.email,
        email_verified: user.email_verified,
        given_name: user.given_name,
        family_name: user.family_name,
        name: `${user.given_name || ''} ${user.family_name || ''}`.trim(),
        nickname: user.nickname,
        picture: user.picture,
        profile: user.profile,
        website: user.website,
      });
    } catch (error) {
      logger.error('Error updating account:', error);
      throw error;
    }
  }

  static async delete(id: string): Promise<void> {
    try {
      const db = await Account.getDatabase();
      const result = await db.query(
        'DELETE FROM users WHERE id = $1 RETURNING id',
        [id]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      logger.info('User deleted successfully:', { id });
    } catch (error) {
      logger.error('Error deleting account:', error);
      throw error;
    }
  }

  async claims(use: string, scope: string, claims: any, rejected: string[]) {
    const profile: any = { sub: this.accountId };

    if (scope.includes('openid')) {
      profile.sub = this.accountId;
    }

    if (scope.includes('profile')) {
      Object.assign(profile, {
        given_name: this.profile.given_name,
        family_name: this.profile.family_name,
        name: this.profile.name,
        nickname: this.profile.nickname,
        picture: this.profile.picture,
        profile: this.profile.profile,
        website: this.profile.website,
        updated_at: this.profile.updated_at,
      });
    }

    if (scope.includes('email')) {
      Object.assign(profile, {
        email: this.profile.email,
        email_verified: this.profile.email_verified,
      });
    }

    return profile;
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
