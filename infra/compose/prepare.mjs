import { mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--tls')) throw new Error('Usage: node prepare.mjs [--tls]');
const tls = args[0] === '--tls';
const directory = fileURLToPath(new URL('./private', import.meta.url));
if (existsSync(directory)) throw new Error('Private directory already exists; preserving it. Inspect and resume explicitly.');
mkdirSync(directory, { mode: 0o700 });
const write = (name, value) => writeFileSync(`${directory}/${name}`, `${value}\n`, { mode: 0o600, flag: 'wx' });
const password = randomBytes(32).toString('hex');
write('db_password', password);
write('database_url', `postgresql://monos:${password}@database:5432/monos`);
write('signing_key', randomBytes(48).toString('hex'));
write('runner_credential', randomBytes(48).toString('hex'));
if (tls) {
  // Keep OpenSSL-created private material restrictive from creation, including failures.
  process.umask(0o077);
  const openssl = (args) => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
  openssl(['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '30', '-subj', '/CN=monos boundary probe CA', '-keyout', 'ca.key', '-out', 'ca.crt',
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    '-addext', 'subjectKeyIdentifier=hash',
    '-addext', 'authorityKeyIdentifier=keyid:always']);
  openssl(['req', '-new', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-subj', '/CN=localhost', '-keyout', 'server.key', '-out', 'server.csr']);
  write('server.ext', 'basicConstraints=critical,CA:FALSE\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer');
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '30', '-sha256', '-extfile', 'server.ext']);
  openssl(['verify', '-x509_strict', '-purpose', 'sslserver', '-verify_ip', '127.0.0.1', '-CAfile', 'ca.crt', 'server.crt']);
  for (const name of ['ca.key', 'server.key']) chmodSync(`${directory}/${name}`, 0o600);
}
console.log(`Prepared private probe credentials${tls ? ' and a localhost-only TLS certificate' : ' for HTTP'}. No existing files were overwritten.`);
