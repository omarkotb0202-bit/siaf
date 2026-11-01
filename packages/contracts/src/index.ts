export type OperationStatus = 'pending' | 'retry' | 'syncing' | 'acknowledged' | 'rejected' | 'review' | 'failed';
export interface OfflineCommand<T = unknown> {
  operationId: string;
  deviceId: string;
  organizationId: string;
  actorId: string;
  operationType: string;
  entityId: string;
  schemaVersion: number;
  localSequence: number;
  payload: T;
  dependencies: string[];
  createdAt: string;
}
export interface ApiError { statusCode: number; code: string; message: string }
export interface SessionTokens { accessToken: string; refreshToken: string; expiresIn: number }
export * from './decimal';
export * from './inventory';
export * from './business';
