import type { ContentPackage } from '../domain/export-profile.js';

export interface WorkspaceIndexManifest {
  readonly manifestVersion: string;
  readonly type: string;
  readonly workspaceId: string;
  readonly part: 'PART_1' | 'PART_2' | 'BOTH';
  readonly grade: string;
  readonly subject: string;
  readonly edition: string;
  readonly title: string;
  readonly storagePolicy?: {
    readonly sourcePdfPersisted?: boolean;
    readonly unitPdfPersisted?: boolean;
    readonly bookPdfPersisted?: boolean;
    readonly textbookPageImagesPersisted?: boolean;
  };
  readonly source: {
    readonly engine: string;
    readonly engineVersion: string;
    readonly sourcePdf: {
      readonly relativePath: string;
      readonly mimeType: string;
      readonly sizeBytes: number;
      readonly sha256: string;
    };
  };
  readonly counts: {
    readonly units: number;
    readonly lessons: number;
    readonly concepts: number;
    readonly questions: number;
    readonly flashcards: number;
    readonly resources: number;
    readonly assets?: number;
  };
  readonly units: ReadonlyArray<{
    readonly unitNumber: number;
    readonly slug: string;
    readonly relativePath: string;
    readonly manifest: string;
    readonly pdf: string;
    readonly lessons: ReadonlyArray<{
      readonly lessonNumber: number;
      readonly slug: string;
      readonly relativePath: string;
      readonly manifest: string;
      readonly pdf: string;
    }>;
  }>;
  readonly package: {
    readonly relativePath: string;
    readonly profile: string;
    readonly profileVersion: string;
  };
  readonly contentVersion: number;
  readonly updatedAt: string;
  readonly contentHash: string;
}

export interface WorkspaceCoordinates {
  readonly part: 'PART_1' | 'PART_2' | 'BOTH';
  readonly grade: string;
  readonly subject: string;
  readonly edition?: string | undefined;
}

export interface WorkspaceInspection {
  readonly indexManifest: unknown | null;
  readonly contentPackage: ContentPackage | null;
}

export interface WorkspacePort {
  getWorkspaceDir(coords: WorkspaceCoordinates): string;
  getWorkspaceDirFromTextbookKey(textbookKey: string): string;
  readContentPackage(workspaceDir: string): Promise<ContentPackage | null>;
  readIndexManifest(workspaceDir: string): Promise<WorkspaceIndexManifest | null>;
  readAssetFile(workspaceDir: string, relativePath: string): Promise<Buffer | null>;
  listAllWorkspaces(): Promise<Array<{ workspaceDir: string; relativePath: string; manifest: WorkspaceIndexManifest; packageExists: boolean }>>;
  inspectWorkspace(workspaceDir: string): Promise<WorkspaceInspection & { workspaceDir: string; sourcePdfExists: boolean; sourcePdfPath: string | null; assets: Array<{ relativePath: string; sizeBytes: number; sha256: string; exists: boolean }> }>;
  segmentWorkspace(workspaceDir: string): Promise<{ indexManifest: WorkspaceIndexManifest; package: ContentPackage }>;
}
