import {
  BaseStream,
  CommandRequestMessage,
  SshAuthenticationType,
  SshChannel,
  SshClientSession,
  SshExtendedDataType,
  SshSessionConfiguration,
  type KeyPair,
  type Stream,
} from '@microsoft/dev-tunnels-ssh';
import { exportPublicKey, importKey } from '@microsoft/dev-tunnels-ssh-keys';
import { Buffer } from 'buffer';
import { BadRequestError, EndpointUnavailableError, UpstreamError } from './errors';
import type { DeviceTool, ExecutionDriver, ExecutionDriverRequest, SshEndpointConfig } from './device';

export interface SshTransport {
  stream: Stream;
  close(): Promise<void>;
}

export interface SshTransportOptions {
  host: string;
  port: number;
}

export interface SshExecutionDriverOptions {
  transport?: (options: SshTransportOptions) => Promise<SshTransport>;
}

export interface SshExecResult {
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  durationMs: number;
}

interface SocketLike {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly opened: Promise<unknown>;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

const SSH_KEY_FORMAT_SSH = 1;
const OPENSSH_PRIVATE_KEY_HEADER = '-----BEGIN OPENSSH PRIVATE KEY-----';

export function createSshExecutionDriver(options: SshExecutionDriverOptions = {}): ExecutionDriver {
  const transportFactory = options.transport ?? createCloudflareSshTransport;
  return {
    async dispatch(request) {
      if (request.endpoint.driver !== 'ssh' || !request.endpoint.ssh) {
        throw new BadRequestError(`Endpoint '${request.endpoint.id}' is not configured for ssh.`);
      }
      return runWithTimeout(request.deadlineMs, () => dispatchSsh(request, request.endpoint.ssh!, transportFactory));
    },
  };
}

async function dispatchSsh(
  request: ExecutionDriverRequest,
  ssh: SshEndpointConfig,
  transportFactory: (options: SshTransportOptions) => Promise<SshTransport>
): Promise<unknown> {
  const key = envString(request.env, ssh.privateKeyEnv, 'ssh.privateKeyEnv');
  if (key.includes(OPENSSH_PRIVATE_KEY_HEADER)) {
    throw new BadRequestError('ssh.privateKeyEnv must contain an RSA/ECDSA PEM or PKCS#8 private key; OpenSSH private keys are not supported yet.');
  }
  const passphrase = ssh.passphraseEnv ? envString(request.env, ssh.passphraseEnv, 'ssh.passphraseEnv') : null;
  const keyPair = await importPrivateKey(key, passphrase);
  const transport = await transportFactory({ host: ssh.host, port: ssh.port ?? 22 });
  let session: SshClientSession | undefined;
  try {
    session = await openAuthenticatedSession(transport.stream, ssh, keyPair);
    if (request.tool === 'exec.run') {
      return await runExec(session, commandFromExecInput(request.input), request.maxOutputBytes);
    }
    if (request.tool === 'fs.read') {
      return await runFsRead(session, request.input, request.maxOutputBytes);
    }
    return unsupportedTool(request.tool);
  } finally {
    session?.dispose();
    await transport.close().catch(() => undefined);
  }
}

async function importPrivateKey(key: string, passphrase: string | null): Promise<KeyPair> {
  try {
    const keyPair = await importKey(key, passphrase);
    if (!keyPair.hasPrivateKey) {
      throw new Error('The imported key does not include private key material.');
    }
    return keyPair;
  } catch (error) {
    throw new BadRequestError(`Failed to import SSH private key: ${messageOf(error)}`);
  }
}

async function openAuthenticatedSession(stream: Stream, ssh: SshEndpointConfig, keyPair: KeyPair): Promise<SshClientSession> {
  const config = new SshSessionConfiguration(true);
  config.keepAliveTimeoutInSeconds = 0;
  const session = new SshClientSession(config);
  const expectedFingerprint = normalizeSha256Fingerprint(ssh.knownHostSha256);
  const authRegistration = session.onAuthenticating((args) => {
    if (args.authenticationType !== SshAuthenticationType.serverPublicKey || !args.publicKey) {
      args.authenticationPromise = Promise.resolve(null);
      return;
    }
    args.authenticationPromise = fingerprintOf(args.publicKey).then((actual) => (actual === expectedFingerprint ? { host: ssh.host } : null));
  });
  try {
    await session.connect(stream);
    const authenticated = await session.authenticate({ username: ssh.username, publicKeys: [keyPair] });
    if (!authenticated) {
      throw new EndpointUnavailableError(`SSH authentication failed for '${ssh.username}@${ssh.host}'.`);
    }
    return session;
  } catch (error) {
    session.dispose();
    if (error instanceof EndpointUnavailableError) {
      throw error;
    }
    throw new EndpointUnavailableError(`SSH connection failed for '${ssh.host}:${ssh.port ?? 22}': ${messageOf(error)}`);
  } finally {
    authRegistration.dispose();
  }
}

async function runExec(session: SshClientSession, command: string, maxOutputBytes: number): Promise<SshExecResult> {
  const startedAt = Date.now();
  const channel = await session.openChannel(SshChannel.sessionChannelType);
  const output = new OutputCapture(maxOutputBytes);
  const dataRegistration = channel.onDataReceived((data) => {
    output.append('stdout', data);
    channel.adjustWindow(data.length);
  });
  const extendedRegistration = channel.onExtendedDataReceived((data) => {
    if (data.dataTypeCode === SshExtendedDataType.STDERR) {
      output.append('stderr', data.data);
    }
    channel.adjustWindow(data.data.length);
  });
  let closedRegistration: { dispose(): void } | undefined;
  try {
    const closed = new Promise<SshExecResult>((resolve, reject) => {
      closedRegistration = channel.onClosed((args) => {
        if (args.error) {
          reject(args.error);
          return;
        }
        resolve({
          exitCode: typeof args.exitStatus === 'number' ? args.exitStatus : null,
          signal: args.exitSignal,
          stdout: output.stdout,
          stderr: output.stderr,
          stdoutTruncated: output.stdoutTruncated || undefined,
          stderrTruncated: output.stderrTruncated || undefined,
          durationMs: Date.now() - startedAt,
        });
      });
    });
    const request = new CommandRequestMessage();
    request.command = command;
    const accepted = await channel.request(request);
    if (!accepted) {
      throw new UpstreamError('SSH server rejected exec request.');
    }
    return await closed;
  } finally {
    dataRegistration.dispose();
    extendedRegistration.dispose();
    closedRegistration?.dispose();
    if (!channel.isClosed) {
      await channel.close().catch(() => undefined);
    }
  }
}

async function runFsRead(session: SshClientSession, input: Record<string, unknown>, maxOutputBytes: number): Promise<unknown> {
  const path = typeof input.path === 'string' ? input.path : undefined;
  if (!path) {
    throw new BadRequestError('fs.read requires path.');
  }
  const maxBytes = Math.min(typeof input.maxBytes === 'number' ? input.maxBytes : maxOutputBytes, maxOutputBytes);
  const result = await runExec(session, `cat -- ${escapePosixArg(path)}`, maxBytes);
  return {
    path,
    content: result.stdout,
    stderr: result.stderr || undefined,
    exitCode: result.exitCode,
    truncated: result.stdoutTruncated || undefined,
    bytes: Buffer.byteLength(result.stdout),
  };
}

function unsupportedTool(tool: DeviceTool): never {
  throw new BadRequestError(`ssh driver does not support '${tool}' yet.`);
}

function commandFromExecInput(input: Record<string, unknown>): string {
  const argv = Array.isArray(input.argv) ? input.argv : undefined;
  if (!argv || argv.length === 0 || !argv.every((part): part is string => typeof part === 'string' && part.length > 0)) {
    throw new BadRequestError('exec.run requires non-empty argv: string[].');
  }
  return buildSshExecCommand(argv, typeof input.cwd === 'string' ? input.cwd : undefined);
}

export function buildSshExecCommand(argv: string[], cwd?: string): string {
  const command = argv.map(escapePosixArg).join(' ');
  return cwd ? `cd ${escapePosixArg(cwd)} && ${command}` : command;
}

export function escapePosixArg(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function fingerprintOf(keyPair: KeyPair): Promise<string> {
  const exported = await exportPublicKey(keyPair, SSH_KEY_FORMAT_SSH);
  const parts = exported.trim().split(/\s+/);
  if (parts.length < 2) {
    throw new Error('Unexpected SSH public key format.');
  }
  const keyBlob = Buffer.from(parts[1], 'base64');
  const digest = await crypto.subtle.digest('SHA-256', keyBlob);
  return `SHA256:${Buffer.from(digest).toString('base64').replace(/=+$/, '')}`;
}

function normalizeSha256Fingerprint(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('SHA256:') ? trimmed.replace(/=+$/, '') : `SHA256:${trimmed.replace(/=+$/, '')}`;
}

async function createCloudflareSshTransport(options: SshTransportOptions): Promise<SshTransport> {
  const { connect } = await import('cloudflare:sockets');
  const socket = connect({ hostname: options.host, port: options.port }, { allowHalfOpen: false }) as SocketLike;
  await socket.opened;
  const stream = new CloudflareSocketStream(socket);
  return {
    stream,
    async close() {
      await stream.close();
    },
  };
}

class CloudflareSocketStream extends BaseStream {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;

  constructor(private readonly socket: SocketLike) {
    super();
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    void this.readLoop();
    void socket.closed.catch((error) => {
      if (!this.disposed) {
        this.onError(asError(error));
        this.fireOnClose(asError(error));
      }
    });
  }

  async write(data: Buffer): Promise<void> {
    if (!data) {
      throw new TypeError('Data is required.');
    }
    if (this.disposed) {
      throw new Error('SSH socket stream is closed.');
    }
    await this.writer.write(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  async close(error?: Error): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await this.writer.close().catch(() => undefined);
    await this.socket.close().catch(() => undefined);
    this.reader.releaseLock();
    this.writer.releaseLock();
    if (error) {
      this.onError(error);
    } else {
      this.onEnd();
    }
    this.fireOnClose(error);
  }

  private async readLoop(): Promise<void> {
    try {
      while (!this.disposed) {
        const { done, value } = await this.reader.read();
        if (done) {
          this.disposed = true;
          this.onEnd();
          this.fireOnClose();
          return;
        }
        if (value) {
          this.onData(Buffer.from(value));
        }
      }
    } catch (error) {
      if (!this.disposed) {
        const err = asError(error);
        this.onError(err);
        this.fireOnClose(err);
      }
    }
  }
}

class OutputCapture {
  stdout = '';
  stderr = '';
  stdoutTruncated = false;
  stderrTruncated = false;
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(target: 'stdout' | 'stderr', data: Buffer): void {
    const remaining = Math.max(this.maxBytes - this.bytes, 0);
    if (remaining === 0) {
      this.markTruncated(target);
      return;
    }
    const accepted = data.length > remaining ? data.subarray(0, remaining) : data;
    this.bytes += accepted.length;
    this[target] += accepted.toString('utf8');
    if (accepted.length < data.length) {
      this.markTruncated(target);
    }
  }

  private markTruncated(target: 'stdout' | 'stderr'): void {
    if (target === 'stdout') {
      this.stdoutTruncated = true;
    } else {
      this.stderrTruncated = true;
    }
  }
}

async function runWithTimeout<T>(timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new EndpointUnavailableError(`SSH operation timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function envString(env: unknown, key: string, label: string): string {
  const value = (env as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestError(`${label} references missing environment variable '${key}'.`);
  }
  return value;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
