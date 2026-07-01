/**
 * Global Error Handler — Safety net untuk uncaught errors di luar route handler
 */
const { reportError } = require('./lib/errorLogger');

// Uncaught Promise rejections
process.on('unhandledRejection', (reason, promise) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    reportError(error, {
        endpoint: 'GLOBAL/unhandledRejection',
        method: 'PROMISE',
    });
});

// Uncaught exceptions
process.on('uncaughtException', (error) => {
    reportError(error, {
        endpoint: 'GLOBAL/uncaughtException',
        method: 'UNCAUGHT',
    });
    // Jangan matikan process — biarkan Next.js handle
});

console.log('[ErrorMonitor] Global error handler registered ✅');
