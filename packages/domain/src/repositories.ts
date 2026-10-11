import { CommandError } from './commands.ts';

export function repositoryIdentity(remote: string): string {
  const invalid = () => new CommandError('invalid_input', 'Use an HTTPS or SSH Git remote without credentials, query or fragment');
  if ((/[\s\\%]/.test(remote) || [...remote].some((c) => c.charCodeAt(0) < 32)) || /%(?:2f|5c|2e|00)/i.test(remote)) throw invalid();
  const scp = /^git@([^/:]+):(.+)$/.exec(remote);
  let url: URL;
  try { url = new URL(scp ? `ssh://git@${scp[1]}/${scp[2]}` : remote); } catch { throw invalid(); }
  if (!['https:', 'ssh:'].includes(url.protocol) || url.password || url.search || url.hash || (url.username && !(url.protocol === 'ssh:' && url.username === 'git'))) throw invalid();
  const path = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  if (!url.hostname || !path || path.split('/').some((part) => !part || part === '.' || part === '..') || /(?:^|\/)\.\.?\//.test(remote)) throw invalid();
  // GitHub's HTTPS and SSH aliases designate one case-insensitive repository.
  if (url.hostname === 'github.com' && !url.port) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path)) throw invalid();
    return `github.com/${path.toLowerCase()}`;
  }
  return `${url.host}/${path}`;
}

// Identity canonicalization is not a transport URL constructor. In particular,
// retain a plain server's exact path, port and .git suffix for every Git request.
export function repositoryAdapter(remote: string): 'github' | 'git_https' {
  const identity = repositoryIdentity(remote);
  if (identity.startsWith('github.com/')) return 'github';
  validateGitHTTPSRemote(remote);
  return 'git_https';
}

export function validateGitHTTPSRemote(remote: string): void {
  const invalid = () => new CommandError('invalid_input', 'Use an exact HTTPS Git remote without credentials, query, fragment or encoded path');
  const parts = /^https:\/\/([^/?#]+)(\/[^?#]+)$/.exec(remote);
  if (!parts || /[\s\\%]/.test(remote) || [...remote].some((part) => part.charCodeAt(0) < 32 || part.charCodeAt(0) === 127)) throw invalid();
  const authority = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?$/.exec(parts[1]!);
  let url: URL;
  try { url = new URL(remote); } catch { throw invalid(); }
  // WHATWG accepts legacy numeric IPv4 and IDNA aliases that Go's URL parser
  // interprets differently. Require the same literal host in both runtimes.
  // Mapped IPv6 is also excluded: WHATWG renders hex; Go renders dotted IPv4.
  if (!authority || url.hostname !== authority[1]!.toLowerCase() || /^\[::ffff:[0-9a-f]+:[0-9a-f]+\]$/.test(url.hostname)
    || !/^[A-Za-z0-9._~$&+,/:;=@-]+$/.test(parts[2]!)
    || !url.hostname || url.username || url.password || parts[1]!.includes('@') || url.pathname !== parts[2]
    || parts[2]!.split('/').slice(1).some((part) => !part || part === '.' || part === '..')) throw invalid();
}

export function validateRepositorySettings(resource: { remote_url: string; default_ref?: string; default_branch?: string; merge_method?: string }): void {
  const adapter = repositoryAdapter(resource.remote_url);
  if (resource.default_ref !== undefined) validateGitRef(resource.default_ref);
  if (resource.default_branch !== undefined) validateGitRef(resource.default_branch);
  if (adapter === 'git_https' && (!resource.default_branch || resource.merge_method !== undefined)) {
    throw new CommandError('invalid_input', 'Plain HTTPS Git requires an explicit target branch and does not support a merge method');
  }
}

export function validateGitRef(ref: string): void {
  if (!ref || ref.startsWith('-') || ref.startsWith('/') || ref.endsWith('/') || ref.endsWith('.') || ref.includes('..') || ref.includes('@{') || ref.includes('//') || ref === '@' || (/[\s~^:?*\\]/.test(ref) || ref.includes('[') || [...ref].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) || ref.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))) throw new CommandError('invalid_input', 'Invalid Git ref');
}
