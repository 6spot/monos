import { describe, expect, it } from 'vitest';
import { repositoryAdapter, repositoryIdentity, validateGitHTTPSRemote, validateRepositorySettings } from './repositories.ts';

describe('repository transport selection', () => {
  it('keeps providerless canonical GitHub aliases on the GitHub adapter', () => {
    for (const remote of ['https://github.com/Owner/Repo.git', 'git@github.com:Owner/Repo.git', 'ssh://git@github.com/Owner/Repo']) {
      expect(repositoryAdapter(remote)).toBe('github');
      expect(repositoryIdentity(remote)).toBe('github.com/owner/repo');
      expect(() => validateRepositorySettings({ remote_url: remote, merge_method: 'squash' })).not.toThrow();
    }
  });

  it('preserves case-sensitive plain HTTPS identity and accepts explicit ports and suffixes', () => {
    for (const remote of ['https://git.example.test:8443/Group/Repo.git', 'https://git.example.test/Group/Repo', 'https://git.example.test:443/Group/Repo.git',
      'https://127.0.0.1:8443/Repo.git', 'https://[2001:db8::1]:8443/Repo.git', 'https://xn--bcher-kva.example/Repo.git']) {
      expect(repositoryAdapter(remote)).toBe('git_https');
      expect(() => validateGitHTTPSRemote(remote)).not.toThrow();
      expect(() => validateRepositorySettings({ remote_url: remote, default_branch: 'release/v1' })).not.toThrow();
    }
    expect(repositoryIdentity('https://git.example.test/Group/Repo.git')).not.toBe(repositoryIdentity('https://git.example.test/group/repo.git'));
  });

  it('rejects ambiguous and unsupported plain transports before admission', () => {
    for (const remote of ['ssh://git@git.example.test/repo.git', 'git@git.example.test:repo.git', 'http://git.example.test/repo.git',
      'https://user@git.example.test/repo', 'https://@git.example.test/repo', 'https://git.example.test/repo?',
      'https://git.example.test/repo#', 'https://git.example.test/a/../repo', 'https://git.example.test/a/.',
      'https://git.example.test/repo%2egit', 'https://git.example.test//repo', 'https://git.example.test/repo/',
      'https://git.example.test/repo\u007f', 'https://git.example.test/a\\repo']) expect(() => repositoryAdapter(remote)).toThrow();
  });

  it('requires an explicit plain target and rejects automatic target-merge settings', () => {
    const plain = { remote_url: 'https://git.example.test/repo.git', default_ref: 'v1' };
    expect(() => validateRepositorySettings(plain)).toThrow();
    expect(() => validateRepositorySettings({ ...plain, default_branch: 'main', merge_method: 'merge' })).toThrow();
    expect(() => validateRepositorySettings({ ...plain, default_branch: '-main' })).toThrow();
  });

  it('rejects host and path spellings interpreted differently by JavaScript and Go', () => {
    for (const remote of ['https://127.1/Repo.git', 'https://0177.0.0.1/Repo.git', 'https://0x7f000001/Repo.git',
      'https://2130706433/Repo.git', 'https://bücher.example/Repo.git', 'https://[::ffff:192.0.2.1]/Repo.git',
      'https://[::ffff:c000:201]/Repo.git', 'https://git.example.test:/Repo.git', 'https://git.example.test/Repo[1].git',
      "https://git.example.test/Repo's.git", 'https://git.example.test/Repo!.git', 'https://git.example.test/Repo|.git']) {
      expect(() => repositoryAdapter(remote)).toThrow();
    }
  });
});
