/**
 * Error logger utility - console only.
 * Tidak kirim ke Telegram.
 */

async function reportError(error, context = {}) {
  console.error(`[ERROR] ${context.endpoint || 'Unknown'}:`, error.message);
}

function configure() {}

module.exports = { reportError, configure };
