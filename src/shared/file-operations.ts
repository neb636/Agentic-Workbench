/** Portable, workspace-relative locations. Absolute paths are resolved only in main. */
export interface FileLocation { root: string; path: string }
export type FileOperation =
  | { kind: "create"; target: FileLocation; entryKind: "file" | "directory" }
  | { kind: "rename"; source: FileLocation; target: FileLocation }
  | { kind: "transfer"; sources: FileLocation[]; destination: FileLocation; move: boolean; collision: "error" | "keep-both" | "skip" }
  | { kind: "duplicate"; sources: FileLocation[] }
  | { kind: "trash"; sources: FileLocation[] }
  | { kind: "undo" } | { kind: "redo" } | { kind: "status" };
export interface FileEffect { source?: FileLocation; target?: FileLocation; removed?: boolean }
export interface FileHistoryState { undo?: string; redo?: string; undoPaths: FileLocation[]; redoPaths: FileLocation[] }
export interface FileOperationResult extends FileHistoryState { effects: FileEffect[]; errors: string[] }

export interface FileOperationProgress { completed: number; total: number; path: string }
