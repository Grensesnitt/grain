export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

export interface LoggerOptions {
  /** Minimum level that gets written; defaults to 'info'. */
  level?: LogLevel;
  /** Human-readable lines instead of JSON; for development terminals. */
  pretty?: boolean;
  /** Fields merged into every line (child loggers extend these). */
  bindings?: LogFields;
  /** Line sink; defaults to console.log. Injectable for tests. */
  write?: (line: string) => void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

// Minimal structured logger: JSON lines by default, level filtering, child
// bindings, Error serialization. Grain registers one in the DI container
// (GrainOptions.logger, or a default) so services can constructor-inject it.
export class Logger {
  private readonly level: LogLevel;
  private readonly pretty: boolean;
  private readonly bindings: LogFields;
  private readonly write: (line: string) => void;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.pretty = options.pretty ?? false;
    this.bindings = options.bindings ?? {};
    this.write = options.write ?? ((line) => console.log(line));
  }

  child(bindings: LogFields): Logger {
    return new Logger({
      level: this.level,
      pretty: this.pretty,
      write: this.write,
      bindings: { ...this.bindings, ...bindings },
    });
  }

  debug(message: string, fields?: LogFields): void {
    this.log('debug', message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.log('info', message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.log('warn', message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.log('error', message, fields);
  }

  private log(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;
    const time = new Date().toISOString();
    const merged: LogFields = { ...this.bindings, ...fields };
    for (const key of Object.keys(merged)) merged[key] = serialize(merged[key]);
    if (this.pretty) {
      const extras = Object.keys(merged).length
        ? ` ${JSON.stringify(merged)}`
        : '';
      this.write(`[${time}] ${level.toUpperCase()} ${message}${extras}`);
    } else {
      this.write(JSON.stringify({ level, time, msg: message, ...merged }));
    }
  }
}
