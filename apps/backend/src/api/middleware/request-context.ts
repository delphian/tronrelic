import type { NextFunction, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers['x-request-id'] ?? uuid());
  req.id = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}
