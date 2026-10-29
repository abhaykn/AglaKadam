/** A check whose expectation was not met. The message says what was expected and what happened. */
export class CheckFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckFailure';
  }
}

/** Fails the current check unless `condition` holds. */
export function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new CheckFailure(message);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function elapsed(startedAt: number): string {
  const milliseconds = Math.round(performance.now() - startedAt);
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

/** Prints each check as it runs and keeps the tally for the summary. */
export class Report {
  passed = 0;
  failed = 0;

  async check<T>(title: string, run: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      const value = await run();
      this.passed += 1;
      console.log(`[ok]     ${title} (${elapsed(startedAt)})`);
      return value;
    } catch (error) {
      this.failed += 1;
      console.log(`[FAILED] ${title} (${elapsed(startedAt)})`);
      console.log(`         ${describeError(error)}`);
      throw error;
    }
  }

  note(message: string): void {
    console.log(`         ${message}`);
  }
}
