import { Request, Response, NextFunction } from 'express';
import { getDataProvider } from '../providers/data-provider-factory.js';
import { logger } from '../utils/logger.js';

export interface AuthenticatedUser {
  userId: string;
  poolId: string;
  email: string;
  name?: string;
  isAdmin?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Simple session-based authentication middleware
 * In a production environment, this should be replaced with proper JWT/session management
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    // For now, we'll use a simple session-like approach with query parameters
    // In production, this would check actual session tokens/JWTs
    const userId = req.query.userId as string || req.headers['x-user-id'] as string;
    const poolId = req.query.poolId as string || req.headers['x-pool-id'] as string;
    
    if (!userId || !poolId) {
      res.status(401).json({ 
        error: 'Authentication required',
        message: 'userId and poolId must be provided'
      });
      return;
    }

    // In a real implementation, you would validate the session token here
    // For now, we'll just populate the user object
    req.user = {
      userId,
      poolId,
      email: '', // Would be populated from session
      isAdmin: false
    };

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(401).json({ 
      error: 'Authentication failed',
      message: 'Invalid session'
    });
  }
}

/**
 * Middleware to require admin privileges
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  try {
    // Simple admin check - in production, this would check roles/permissions
    const adminEmail = req.query.adminEmail as string || req.headers['x-admin-email'] as string;
    
    if (!adminEmail) {
      res.status(403).json({ 
        error: 'Admin access required',
        message: 'Admin email must be provided'
      });
      return;
    }

    // In production, verify admin permissions from database/session
    req.user = {
      userId: 'admin',
      poolId: 'admin',
      email: adminEmail,
      isAdmin: true
    };

    next();
  } catch (error) {
    logger.error('Admin authentication error:', error);
    res.status(403).json({ 
      error: 'Admin authentication failed',
      message: 'Invalid admin session'
    });
  }
}

/**
 * Middleware to load user details from database
 */
export async function loadUserDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next();
      return;
    }

    const dataProvider = getDataProvider();
    const user = await dataProvider.getUser(req.user.poolId, req.user.userId);
    
    if (user) {
      req.user.email = user.email;
      req.user.name = user.name || user.givenName || user.familyName;
    }

    next();
  } catch (error) {
    logger.error('Error loading user details:', error);
    next(); // Continue even if user loading fails
  }
}

/**
 * Helper function to get current user from request
 */
export function getCurrentUser(req: Request): AuthenticatedUser | null {
  return req.user || null;
}
