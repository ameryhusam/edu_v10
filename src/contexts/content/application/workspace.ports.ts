import type { ContentPackage } from '../domain/export-profile.js';

export interface WorkspaceCoordinates {
  readonly term: string;
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
  readAssetFile(workspaceDir: string, relativePath: string): Promise<Buffer | null>;
  inspectWorkspace(workspaceDir: string): Promise<WorkspaceInspection>;
}
