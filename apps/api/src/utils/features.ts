import { ErrorCode } from '../errors';
import type { Env } from '../types';
import { errorResponse, type ApiErrorResponse } from './response';

export type FeatureFlag =
  | 'ACCOUNT_FEATURES_ENABLED'
  | 'ALERT_EVALUATION_ENABLED'
  | 'ADMIN_ROUTES_ENABLED';

export function featureEnabled(env: Env, flag: FeatureFlag): boolean {
  return env[flag] === 'true' || (env[flag] === undefined && env.ENVIRONMENT === 'local');
}

export function featureDisabledEnvelope(message: string): ApiErrorResponse {
  return errorResponse(message, ErrorCode.FEATURE_DISABLED);
}
