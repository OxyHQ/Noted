import { OxyServices } from '@oxy.so/core';
import { OXY_CLIENT_ID } from './oxy-client-id';

export const oxyServices = new OxyServices({
  baseURL: process.env.EXPO_PUBLIC_OXY_API_URL || 'https://api.oxy.so',
  clientId: OXY_CLIENT_ID,
});
