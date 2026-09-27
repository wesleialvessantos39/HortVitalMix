import {defineConfig,devices} from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base,testMatch:'**/iphone-responsive.spec.ts',use:{...base.use,...devices['iPhone 13'],browserName:'chromium',launchOptions:base.use?.launchOptions}});
