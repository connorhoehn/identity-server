import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  logger.error('Unhandled error:', err);

  if (res.headersSent) {
    return next(err);
  }

  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(500).render('error', {
    title: 'Internal Server Error',
    message: isDevelopment ? err.message : 'An internal server error occurred',
    stack: isDevelopment ? err.stack : undefined,
  });
}
