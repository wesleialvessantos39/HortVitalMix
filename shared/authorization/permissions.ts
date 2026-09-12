export const PLATFORM_PERMISSIONS = {
  configRead: 'platform.config.read',
  configManage: 'platform.config.manage',
} as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS];
