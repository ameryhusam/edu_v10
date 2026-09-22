export interface ContentEnginePrepareInput {
  readonly pdf: Buffer;
  readonly workspaceDir: string;
  readonly subject: string;
  readonly grade: string;
  readonly part: 'PART_1' | 'PART_2' | 'BOTH';
  readonly edition?: string;
  readonly title?: string;
  readonly timeoutMs: number;
}

export interface ContentEnginePrepareResult {
  readonly workspaceDir: string;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ContentEnginePort {
  prepare(input: ContentEnginePrepareInput): Promise<ContentEnginePrepareResult>;
}
