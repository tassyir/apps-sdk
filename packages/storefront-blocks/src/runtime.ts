import { BLOCK_LIMITS, RENDER_STEP_COSTS } from './limits.js';
import type { Value, Work } from './values.js';
import { deepSize } from './values.js';

export type RenderLimitCode =
  | 'BLOCK_RENDER_STEP_LIMIT'
  | 'BLOCK_RENDER_OUTPUT_LIMIT'
  | 'BLOCK_RENDER_STRING_LIMIT'
  | 'BLOCK_RENDER_ARRAY_LIMIT';

/** A render stopped by one of its limits. Never caught inside the template. */
export class RenderLimitError extends Error {
  constructor(
    readonly code: RenderLimitCode,
    message: string,
  ) {
    super(message);
  }
}

/** The language a block renders in, from the store's locale. */
export type BlockLanguage = 'ar' | 'fr' | 'en';

/** What filters may read and spend. */
export interface FilterRuntime {
  readonly language: BlockLanguage;
  /** The store's currency code (`DZD` for Algerian stores). */
  readonly currency: string;
  spend(steps: number): void;
}

/** The step budget of one render. */
export class StepMeter {
  used = 0;

  constructor(private readonly budget: number = BLOCK_LIMITS.steps) {}

  spend(steps: number): void {
    this.used += steps;
    if (this.used > this.budget) {
      throw new RenderLimitError(
        'BLOCK_RENDER_STEP_LIMIT',
        `The render used more than ${this.budget.toString()} steps.`,
      );
    }
  }
}

/** The size share of a filter: one step per `perChars` characters or items. */
export function sizeSteps(size: number): number {
  return Math.floor(size / RENDER_STEP_COSTS.perChars);
}

/** The most a size is counted to: past it, the budget is spent anyway. */
const SIZE_CAP = BLOCK_LIMITS.steps * RENDER_STEP_COSTS.perChars;

/** Steps for reading these values whole: their characters and items. */
export function readSteps(...values: Value[]): number {
  let size = 0;
  for (const value of values) size += deepSize(value, SIZE_CAP - size);
  return sizeSteps(size);
}

/** Charges comparison work once it adds up, and resets it. Called inside
 * loops (a sort's comparator), so a costly comparison stops the render
 * before the loop ends, not after. */
export function chargeWork(
  rt: Pick<FilterRuntime, 'spend'>,
  work: Work,
  now = false,
): void {
  if (now || work.n >= RENDER_STEP_COSTS.perChars * 16) {
    rt.spend(sizeSteps(work.n));
    work.n = 0;
  }
}

/** Refuses a string longer than a template may build. */
export function checkStringLength(length: number): void {
  if (length > BLOCK_LIMITS.stringLength) {
    throw new RenderLimitError(
      'BLOCK_RENDER_STRING_LIMIT',
      `The template built a string of more than ${BLOCK_LIMITS.stringLength.toString()} characters.`,
    );
  }
}

/** Refuses an array longer than a template may build. */
export function checkArrayLength(length: number): void {
  if (length > BLOCK_LIMITS.arrayItems) {
    throw new RenderLimitError(
      'BLOCK_RENDER_ARRAY_LIMIT',
      `The template built a list of more than ${BLOCK_LIMITS.arrayItems.toString()} items.`,
    );
  }
}
