import { AppConfig } from '../types';

export const APP_CONFIG: AppConfig = {
  appName: 'Base Application',
  version: '1.0.0',
  environment: import.meta.env.MODE || 'development',
  locale: 'pt-BR',
};

export const THEME_STORAGE_KEY = 'app_theme_preference';
