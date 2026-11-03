import { UnexpectedResponseError } from './errors.ts';

/**
 * Small readers for what an operator returns. Every response is checked
 * where it enters (design §3.3), so a wrong shape fails loudly here rather
 * than three components later. Fields the console does not use are ignored,
 * so an operator adding a field never breaks it.
 */
export type Json = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class Reader {
  constructor(
    private readonly path: string,
    private readonly value: Json,
  ) {}

  static of(path: string, value: unknown): Reader {
    if (!isRecord(value)) throw new UnexpectedResponseError(path, 'not an object');
    return new Reader(path, value);
  }

  private fail(field: string, want: string): never {
    throw new UnexpectedResponseError(this.path, `${field} is not ${want}`);
  }

  string(field: string): string {
    const v = this.value[field];
    return typeof v === 'string' ? v : this.fail(field, 'a string');
  }

  optString(field: string): string | undefined {
    const v = this.value[field];
    if (v === undefined || v === null) return undefined;
    return typeof v === 'string' ? v : this.fail(field, 'a string');
  }

  number(field: string): number {
    const v = this.value[field];
    return typeof v === 'number' ? v : this.fail(field, 'a number');
  }

  optNumber(field: string): number | undefined {
    const v = this.value[field];
    if (v === undefined || v === null) return undefined;
    return typeof v === 'number' ? v : this.fail(field, 'a number');
  }

  boolean(field: string): boolean {
    const v = this.value[field];
    return typeof v === 'boolean' ? v : this.fail(field, 'a boolean');
  }

  optBoolean(field: string): boolean | undefined {
    const v = this.value[field];
    if (v === undefined || v === null) return undefined;
    return typeof v === 'boolean' ? v : this.fail(field, 'a boolean');
  }

  strings(field: string): readonly string[] {
    const v = this.value[field];
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
      return this.fail(field, 'a list of strings');
    }
    return v;
  }

  optStrings(field: string): readonly string[] {
    return this.value[field] === undefined ? [] : this.strings(field);
  }

  record(field: string): Reader {
    const v = this.value[field];
    return isRecord(v) ? new Reader(`${this.path}.${field}`, v) : this.fail(field, 'an object');
  }

  optRecord(field: string): Reader | undefined {
    const v = this.value[field];
    if (v === undefined || v === null) return undefined;
    return this.record(field);
  }

  raw(field: string): unknown {
    return this.value[field];
  }

  list<T>(field: string, read: (item: Reader) => T): readonly T[] {
    const v = this.value[field];
    if (!Array.isArray(v)) return this.fail(field, 'a list');
    return v.map((item, i) => read(Reader.of(`${this.path}.${field}[${String(i)}]`, item)));
  }
}

/** A top-level JSON array of objects. */
export function readArray<T>(
  path: string,
  value: unknown,
  read: (item: Reader) => T,
): readonly T[] {
  if (!Array.isArray(value)) throw new UnexpectedResponseError(path, 'not a list');
  return value.map((item, i) => read(Reader.of(`${path}[${String(i)}]`, item)));
}
