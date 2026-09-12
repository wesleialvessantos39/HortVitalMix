/**
 * Core application types and foundation interfaces.
 */

export type Status = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  data: T | null;
  status: Status;
  error: string | null;
}

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface NotificationMessage {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  createdAt: number;
}

export interface NavigationItem {
  id: string;
  label: string;
  href?: string;
  icon?: string;
  isActive?: boolean;
}

export interface AppConfig {
  appName: string;
  version: string;
  environment: string;
  locale: string;
}
