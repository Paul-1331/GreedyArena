import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma.js';

export const optionalAuth = async (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id, email: decoded.email };
    next();
  } catch {
    next();
  }
};

export const requireAuth = async (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const roles = await prisma.user_roles.findMany({
      where: { user_id: decoded.id },
      select: { role: true },
    });

    req.user = {
      id: decoded.id,
      email: decoded.email,
      roles: roles.map((r) => r.role), // e.g. ['admin'] or []
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const requireAdmin = (req, res, next) => {
  if (!req.user?.roles?.includes('admin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};