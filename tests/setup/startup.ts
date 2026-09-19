if (process.env.APP_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
  throw new Error('TEST_GUARD_PRODUCTION: testes não podem executar contra production.');
}
