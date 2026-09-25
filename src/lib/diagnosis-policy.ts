/** Experiment trust and model admission policies, independent of network/HTTP state. */
import type { ExperimentConfig, RubricItem } from './api-types';
import { calculateExperiment } from './calculations';

export const MAX_CONCURRENT_GENERATIONS = 4;
export const GENERATION_BUDGET_MS = 90_000;
export const MODEL_REQUEST_TIMEOUT_MS = 40_000;
export interface ExperimentSnapshot extends ExperimentConfig {
  configuration_confirmed?: boolean;
  experiment_version?: number;
}
export function effectiveExperiment(config:ExperimentConfig,rubric:RubricItem[],confirmed:boolean,faultId:string,version:number) {
  const trustedConfig=confirmed?config:{};
  const trustedRubric=confirmed?rubric:[];
  return {
    config:trustedConfig,rubric:trustedRubric,calculations:calculateExperiment(trustedConfig,faultId),
    snapshot:{...config,configuration_confirmed:confirmed,experiment_version:version} satisfies ExperimentSnapshot,
  };
}
/** Flags only quantitative engineering claims, not task numbers or graph identifiers. */
export function hasQuantitativeGuidance(text:string):boolean {
  return /(?:\b0x[\da-f]+\b|\b\d[\da-f]*H\b|\d+(?:\.\d+)?\s*(?:MHz|kHz|Hz|ms|us|μs|baud|bps|s\b|毫秒|微秒|秒|赫兹|分频|个时钟|T\b)|(?:初值|重装值|TH[01]?|TL[01]?|计数次数|计数值|EA|ET[01]|TR[01])\s*(?:应为|设为|=|为|：|:)\s*\d)/i.test(text);
}
export function modelTimeout(deadlineAt:number,now=Date.now()):number {
  if(!Number.isFinite(deadlineAt))return 0;
  return Math.max(0,Math.min(MODEL_REQUEST_TIMEOUT_MS,Math.floor(deadlineAt-now)));
}
export function canAdmitGeneration(active:number):boolean {
  return Number.isSafeInteger(active) && active>=0 && active<MAX_CONCURRENT_GENERATIONS;
}
