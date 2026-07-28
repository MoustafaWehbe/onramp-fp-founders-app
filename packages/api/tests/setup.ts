// Global test setup — runs before each test file

// Silence console output during tests
global.console.info = jest.fn();
global.console.log = jest.fn();

// Set test environment variables
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-32-chars-minimum";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-32-chars-minimum";
process.env.OTP_HMAC_SECRET = "test-otp-hmac-secret-32-chars-minimum";
process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/fp_founders_test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.RESEND_API_KEY = "re_test_key";
process.env.RESEND_FROM = "FP Founders <noreply@fpfounders.com>";
process.env.APP_URL = "http://localhost:5173";
