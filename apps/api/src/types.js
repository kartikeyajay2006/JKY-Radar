/**
 * Shared JSDoc types for the API.
 *
 * @typedef {Object} AuthInfo
 * @property {import('mongoose').Types.ObjectId} userId
 * @property {import('mongoose').Types.ObjectId} sessionId
 * @property {{ id: string; email: string; name: string; preferences: { theme: 'system' | 'light' | 'dark' }; createdAt: Date }} user
 */

/**
 * Express request with the fields added by JKY-Radar middleware.
 * @typedef {import('express').Request & { requestId: string; auth?: AuthInfo }} AppRequest
 */

export {};
