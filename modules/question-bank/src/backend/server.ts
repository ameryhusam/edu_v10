#!/usr/bin/env node

// Minimal Express backend skeleton for Question Bank (PHASE 2A)
// This file is a non-production demo server used to validate routes and contracts.

import express from 'express';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json());

// Health
app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', product: 'Question Bank (prototype)' }));

// Auth (mock)
app.post('/api/v1/auth/login', (req, res) => {
  const { username } = req.body;
  // return a mock token
  res.json({ token: 'mock-token', user: { id: 'u-student', username } });
});

// Subjects (mock)
app.get('/api/v1/subjects', (req, res) => {
  const grade = req.query.grade;
  // Return sample subjects; in PHASE2 we'll wire to DB
  res.json([
    { id: 's-math', key: 'MATH', name: 'Mathematics', part: 'PART_1' },
    { id: 's-sci', key: 'SCI', name: 'Science', part: 'PART_1' },
  ]);
});

// Exams: create (admin) and self-generate (student)
app.post('/api/v1/exams', (req, res) => {
  // For PHASE2A this is a stub
  const id = `exam-${Date.now()}`;
  res.status(201).json({ id, ...req.body });
});

app.post('/api/v1/exams/self-generate', (req, res) => {
  const id = `exam-${Date.now()}`;
  res.status(201).json({ id });
});

// Attempts skeleton
app.post('/api/v1/exams/:id/start', (req, res) => {
  const attemptId = `att-${Date.now()}`;
  res.json({ attemptId, firstItem: null });
});

app.post('/api/v1/attempts/:id/answer', (req, res) => {
  // Store answerPayload to DB in PHASE2B; stub for now
  res.status(204).send();
});

app.post('/api/v1/attempts/:id/submit', (req, res) => {
  // Trigger grading worker in PHASE2B; return summary stub
  res.json({ totalScore: 0, evaluated: false });
});

// Imports
app.post('/api/v1/questions/import', (req, res) => {
  // Accept file upload or JSON payload in PHASE2B; stub now
  res.status(202).json({ jobId: `job-${Date.now()}`, status: 'PENDING' });
});

app.get('/api/v1/imports/:jobId', (req, res) => {
  res.json({ jobId: req.params.jobId, status: 'READY_FOR_REVIEW', items: [] });
});

const port = process.env.PORT ? Number(process.env.PORT) : 4001;
app.listen(port, () => console.log(`Question Bank prototype API listening on http://localhost:${port}`));
