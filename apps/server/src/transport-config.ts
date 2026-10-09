import { readFile } from 'node:fs/promises';
import { createSecureContext } from 'node:tls';

export async function serverTLS(env: NodeJS.ProcessEnv): Promise<{ key: Buffer; cert: Buffer } | undefined> {
  const keyFile = env.MONOS_TLS_KEY_FILE;
  const certFile = env.MONOS_TLS_CERT_FILE;
  if (keyFile === undefined && certFile === undefined) return undefined;
  if (!keyFile || !certFile) throw new Error('MONOS_TLS_KEY_FILE and MONOS_TLS_CERT_FILE must both be configured, or both omitted for HTTP');
  try {
    const [key, cert] = await Promise.all([readFile(keyFile), readFile(certFile)]);
    createSecureContext({ key, cert });
    return { key, cert };
  } catch {
    throw new Error('TLS certificate and key files must be readable and form a valid pair');
  }
}
