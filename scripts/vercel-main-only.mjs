// Vercel ignored-build contract: 0 skips; 1 continues the build.
// Only the canonical Git main branch may publish this project.
process.exit(process.env.VERCEL_GIT_COMMIT_REF === "main" ? 1 : 0);
