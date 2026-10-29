/**
 * Asking two services in turn: the first choice while its credit lasts, the second when it cannot
 * answer. A service that is known to be out of credit, or whose key was removed, is not asked
 * again for a while, so a spent credit costs one failed call and not one for every question.
 */

import {
  CompletionError,
  wasGenerated,
  type Completion,
  type CompletionFailure,
  type CompletionRequest,
  type LanguageModel,
  type ProviderName,
} from './llm.ts';
import type { SahayakServices } from './services.ts';

/** The identifier under which allowances shared by the whole project are counted. */
export const PROJECT_ID = '00000000-0000-0000-0000-000000000000';

/** How long a service is left alone after a failure of the given kind, in milliseconds. */
const REST_MS: Partial<Record<CompletionFailure, number>> = {
  // Credit does not come back within the hour; the next check is cheap.
  exhausted: 60 * 60_000,
  // A key that was removed or revoked is not mended by asking again.
  not_configured: 15 * 60_000,
  busy: 30_000,
  unavailable: 20_000,
};

/** Remembers which services to leave alone for now. */
export class ProviderBreaker {
  private readonly restingUntil = new Map<string, number>();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  /** Whether the service may be asked now. */
  isOpen(model: LanguageModel): boolean {
    const until = this.restingUntil.get(this.keyOf(model));
    return until === undefined || until <= this.clock();
  }

  /** Notes why a service failed; a failure that says nothing about the service is not noted. */
  note(model: LanguageModel, reason: CompletionFailure): void {
    const rest = REST_MS[reason];
    if (rest !== undefined) {
      this.restingUntil.set(this.keyOf(model), this.clock() + rest);
    }
  }

  /** A service that answered is asked as usual again. */
  clear(model: LanguageModel): void {
    this.restingUntil.delete(this.keyOf(model));
  }

  private keyOf(model: LanguageModel): string {
    return `${model.provider}:${model.model}`;
  }
}

export interface FailoverAnswer extends Completion {
  /** Whether a service after the first choice answered. */
  fellBack: boolean;
}

/**
 * Asks the models in order and returns the first answer. A model that is resting is skipped; when
 * every model fails, the error that says most is raised: a refusal tells more than a busy service,
 * and that more than a missing key.
 */
export async function completeInOrder(
  models: readonly LanguageModel[],
  request: CompletionRequest,
  breaker: ProviderBreaker,
): Promise<FailoverAnswer> {
  const ranking: CompletionFailure[] = [
    'not_configured',
    'exhausted',
    'unavailable',
    'busy',
    'rejected',
    'refused',
  ];
  let worst: CompletionError | null = null;
  let asked = 0;
  for (const model of models) {
    if (!breaker.isOpen(model)) {
      continue;
    }
    try {
      const completion = await model.complete(request);
      breaker.clear(model);
      return { ...completion, fellBack: asked > 0 };
    } catch (error) {
      if (!(error instanceof CompletionError)) {
        throw error;
      }
      asked += 1;
      breaker.note(model, error.reason);
      if (!worst || ranking.indexOf(error.reason) >= ranking.indexOf(worst.reason)) {
        worst = error;
      }
    }
  }
  throw worst ?? new CompletionError('unavailable', models[0]?.provider ?? 'groq', 'all resting');
}

export interface FirstChoice {
  model: LanguageModel;
  /** Requests one person may make a day, so that the project's credit is shared. */
  perPerson: number;
  /** Requests the whole project may make a day. */
  perProject: number;
}

type QuotaServices = Pick<SahayakServices, 'takeQuota' | 'returnQuota'>;

/**
 * Asks the first choice while the person's share and the project's allowance last, and the
 * fallbacks otherwise or when it cannot answer: the credit running out never stops the help.
 *
 * A request the first choice answered (also with an answer that could not be used), or turned down
 * because its credit is used up, stays counted; any other failure is given back.
 */
export async function askWithFallback(
  services: QuotaServices,
  breaker: ProviderBreaker,
  profileId: string,
  first: FirstChoice | null,
  fallbacks: readonly LanguageModel[],
  request: CompletionRequest,
): Promise<FailoverAnswer> {
  const kind: ProviderName = first?.model.provider ?? 'claude';
  let firstFailure: CompletionError | null = null;
  if (
    first &&
    breaker.isOpen(first.model) &&
    (await services.takeQuota(profileId, kind, first.perPerson))
  ) {
    let projectTaken = false;
    try {
      projectTaken = await services.takeQuota(PROJECT_ID, kind, first.perProject);
      if (projectTaken) {
        const completion = await first.model.complete(request);
        breaker.clear(first.model);
        return { ...completion, fellBack: false };
      }
      // The project's allowance for the day is spent: the person's share is given back.
      await services.returnQuota(profileId, kind).catch(() => undefined);
    } catch (error) {
      const known = error instanceof CompletionError;
      if (known) {
        breaker.note(first.model, error.reason);
      }
      // A request stays counted when the service answered (even with an answer that could not be
      // used) or said its credit is used up. Anything else, an unexpected failure included, is
      // given back.
      if (!known || (error.reason !== 'exhausted' && !wasGenerated(error))) {
        if (projectTaken) {
          await services.returnQuota(PROJECT_ID, kind).catch(() => undefined);
        }
        await services.returnQuota(profileId, kind).catch(() => undefined);
      }
      if (!known) {
        throw error;
      }
      firstFailure = error;
    }
  }
  if (fallbacks.length === 0 && firstFailure) {
    throw firstFailure;
  }
  const answer = await completeInOrder(fallbacks, request, breaker);
  return { ...answer, fellBack: first !== null };
}
