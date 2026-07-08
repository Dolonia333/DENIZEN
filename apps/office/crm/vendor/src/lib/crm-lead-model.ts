/** Client-side lead scoring model state — persisted via meridian_leadModelState */

export interface LeadModelTrainingPoint {
  epoch: number;
  accuracy: number;
  loss: number;
}

export interface ConfusionMatrix {
  truePos: number;
  falsePos: number;
  falseNeg: number;
  trueNeg: number;
}

export interface LeadModelState {
  version: string;
  estimatedAccuracy: number;
  trainingHistory: LeadModelTrainingPoint[];
  confusionMatrix: ConfusionMatrix;
  lastTrainedAt: string | null;
}

export const DEFAULT_LEAD_MODEL_STATE: LeadModelState = {
  version: "v1",
  estimatedAccuracy: 62,
  trainingHistory: [
    { epoch: 1, accuracy: 48, loss: 0.52 },
    { epoch: 2, accuracy: 55, loss: 0.44 },
    { epoch: 3, accuracy: 62, loss: 0.36 },
  ],
  confusionMatrix: { truePos: 12, falsePos: 5, falseNeg: 4, trueNeg: 18 },
  lastTrainedAt: null,
};

export function applyTrainModelV2(state: LeadModelState): LeadModelState {
  const nextEpoch = state.trainingHistory.length + 1;
  return {
    version: "v2",
    estimatedAccuracy: 78,
    trainingHistory: [
      ...state.trainingHistory,
      { epoch: nextEpoch, accuracy: 71, loss: 0.28 },
      { epoch: nextEpoch + 1, accuracy: 78, loss: 0.22 },
    ],
    confusionMatrix: { truePos: 16, falsePos: 3, falseNeg: 2, trueNeg: 20 },
    lastTrainedAt: new Date().toISOString(),
  };
}

export const CONFUSION_MATRIX_LABELS = {
  truePos: { short: "True Pos", hint: "Correctly predicted won deals" },
  falseNeg: { short: "False Neg", hint: "Deals we missed that closed" },
  falsePos: { short: "False Pos", hint: "Leads predicted high but lost" },
  trueNeg: { short: "True Neg", hint: "Correctly ignored cold leads" },
} as const;
