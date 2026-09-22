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
  identify(input: ContentEngineIdentityInput): Promise<ContentEngineIdentityResult>;
  prepare(input: ContentEnginePrepareInput): Promise<ContentEnginePrepareResult>;
}


export interface ContentEngineIdentityResult {
  readonly schemaVersion: string;
  readonly status: 'PROPOSED' | 'NEEDS_REVIEW';
  readonly source: {
    readonly fileName: string;
    readonly sha256: string;
    readonly pageCount: number;
    readonly analysisPages: number;
  };
  readonly identity: {
    readonly title?: string | null;
    readonly subjectKey?: string | null;
    readonly gradeKey?: string | null;
    readonly part?: 'PART_1' | 'PART_2' | 'BOTH' | null;
    readonly edition?: string | null;
    readonly printingYear?: number | null;
    readonly publicationYear?: number | null;
    readonly issuer?: string | null;
  };
  readonly evidence: readonly Record<string, unknown>[];
  readonly conflicts: readonly string[];
  readonly toc?: Record<string, unknown>;
}

export interface ContentEngineIdentityInput {
  readonly pdf: Buffer;
  readonly analysisPages?: number;
  readonly dpi?: number;
  readonly model?: string;
}

