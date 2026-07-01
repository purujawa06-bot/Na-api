/**
 * Instrumentation — Next.js server-side initialization
 * Auto-load error monitor untuk global error catching
 */
export async function register() {
    // Only run on server
    if (typeof window !== 'undefined') return;

    try {
        const { reportError } = await import('./lib/errorLogger');

        // Unhandled Promise rejections
        process.on('unhandledRejection', (reason) => {
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
        });

        console.log('[Instrumentation] Error monitor registered ✅');
    } catch (err) {
        console.error('[Instrumentation] Gagal register error monitor:', err.message);
    }
}
