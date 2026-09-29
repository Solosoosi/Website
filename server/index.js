import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createMailer } from './mailer.js';
import { openStore } from './store.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'site.json'), 'utf8'));
const env = process.env;

const dataDir = env.DATA_DIR || path.join(root, 'data');
const store = openStore(path.join(dataDir, 'site.db'), config.defaultSchedule);
const mailer = createMailer(env);
const app = createApp({ config, store, mailer, env });

if (!env.ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is not set – the admin panel is disabled.');
if (!mailer.enabled) console.warn('SMTP_HOST is not set – emails will be logged instead of sent.');

const port = Number(env.PORT || 3000);
const server = app.listen(port, () => console.log(`Site running on http://localhost:${port}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
