import { previewImportFromSample } from '../import/json-import';
import { evaluateMCQ } from '../evaluators/mcq';
import { evaluateTrueFalse } from '../evaluators/truefalse';
import { evaluateNumeric } from '../evaluators/numeric';
import { evaluateShortText } from '../evaluators/shorttext';
import { evaluateMatching } from '../evaluators/matching';
import { evaluateOrdering } from '../evaluators/ordering';
import { evaluateFillBlank } from '../evaluators/fillblank';
import { evaluateEssay } from '../evaluators/essay';

export async function runSampleImportPreview() {
  const items = await previewImportFromSample('modules/question-bank/sample/questions.json');
  return items;
}

export function demoEvaluation() {
  // For demonstration: evaluate sample MCQ
}
