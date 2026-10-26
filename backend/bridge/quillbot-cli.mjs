// QuillBot bridge: Cloudflare rejects plain requests from some data-center IPs,
// so the Go provider falls back to the existing cloudscraper client.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const bridgeDir = path.dirname(fileURLToPath(import.meta.url));
const localModule = path.join(bridgeDir, 'quillbot-web.js');
const repoModule = path.resolve(bridgeDir, '..', '..', 'lib', 'quillbot-web.js');
const modulePath = fs.existsSync(localModule) ? localModule : repoModule;

if (!fs.existsSync(modulePath)) {
  console.error('QuillBot bridge module not found');
  process.exit(1);
}

console.log = (...args) => console.error(...args);

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const prompt = Buffer.concat(chunks).toString('utf8');

try {
  const { generateQuillbot } = await import(pathToFileURL(modulePath).href);
  const result = await generateQuillbot({ prompt });
  process.stdout.write(JSON.stringify({ text: result.text }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
