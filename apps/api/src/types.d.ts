import type { Types } from 'mongoose';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: {
        userId: Types.ObjectId;
        sessionId: Types.ObjectId;
        user: {
          id: string;
          email: string;
          name: string;
          preferences: { theme: 'system' | 'light' | 'dark' };
          createdAt: Date;
        };
      };
    }
  }
}

export {};
