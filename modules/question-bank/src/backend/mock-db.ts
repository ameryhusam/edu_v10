// Lightweight in-memory mock database for early PHASE 2 testing

export const db = {
  exams: new Map<string, any>(),
  attempts: new Map<string, any>(),
  importJobs: new Map<string, any>(),
};
