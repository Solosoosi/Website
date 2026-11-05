// Makes a one-time sign-in link for the admin panel, straight in the database: for the very first
// person, or after the site moves to a new address (a passkey works only on the address it was
// made on). Everyone after that is invited from the admin panel's "מנהלים" tab.
//
//   npm run admin:invite -- https://clinic.davidneeman.workers.dev "דוד" 24
//   npm run admin:invite -- http://localhost:8787            (the local database)
//
// Only the code's hash is stored; the link itself is printed once, here.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const [site = '', name = '', hours = '24'] = process.argv.slice(2);
const local = /^http:\/\/localhost(:\d+)?\/?$/.test(site);
const h = Number(hours);
if ((!local && !/^https:\/\/[a-z0-9.-]+\/?$/i.test(site)) || !(h > 0 && h <= 72)) {
  console.error('Usage: npm run admin:invite -- https://<site address> [name] [hours, up to 72]');
  process.exit(1);
}

const code = crypto.randomBytes(24).toString('base64url');
const hash = crypto.createHash('sha256').update(code).digest('hex');
const expires = new Date(Date.now() + h * 3_600_000).toISOString();
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql = `INSERT INTO invites (code_hash, name, expires_at) VALUES (${quote(hash)}, ${name ? quote(name.slice(0, 60)) : 'NULL'}, ${quote(expires)})`;

execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'd1', 'execute', 'clinic', local ? '--local' : '--remote', '--command', sql], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
console.log(`\n${site.replace(/\/$/, '')}/admin#invite=${code}\n`);
console.log(`Works once, until ${expires}. Open it on the phone that will sign in.`);
