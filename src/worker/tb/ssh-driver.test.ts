import { describe, expect, it } from 'vitest';
import { buildSshExecCommand, createSshExecutionDriver, escapePosixArg } from './ssh-driver';

describe('ssh execution driver helpers', () => {
  it('quotes argv as POSIX shell arguments', () => {
    expect(escapePosixArg('hello')).toBe("'hello'");
    expect(escapePosixArg('')).toBe("''");
    expect(escapePosixArg("it's")).toBe("'it'\\''s'");
    expect(escapePosixArg('$(uname -a)')).toBe("'$(uname -a)'");
  });

  it('builds exec commands without exposing raw shell concatenation', () => {
    expect(buildSshExecCommand(['npm', 'test'])).toBe("'npm' 'test'");
    expect(buildSshExecCommand(['bash', '-lc', 'pwd && id'], '/workspace/project')).toBe(
      "cd '/workspace/project' && 'bash' '-lc' 'pwd && id'"
    );
  });

  it('rejects OpenSSH private key secrets before connecting', async () => {
    const driver = createSshExecutionDriver({
      async transport() {
        throw new Error('transport should not be opened');
      },
    });
    await expect(
      driver.dispatch({
        env: { SSH_KEY: '-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----' } as never,
        endpoint: {
          id: 'ssh_1',
          kind: 'ssh-host',
          driver: 'ssh',
          status: 'online',
          capabilities: ['exec.run'],
          ssh: {
            host: '203.0.113.10',
            username: 'ubuntu',
            privateKeyEnv: 'SSH_KEY',
            knownHostSha256: 'SHA256:test',
          },
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        tool: 'exec.run',
        traceId: 'trc_test',
        input: { argv: ['pwd'] },
        deadlineMs: 1000,
        maxOutputBytes: 1024,
      })
    ).rejects.toThrow('OpenSSH private keys are not supported yet');
  });
});
