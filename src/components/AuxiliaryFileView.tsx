import FileDocumentView from "@/components/FileDocumentView";
import type { MarkdownViewMode } from "@/components/ui/MarkdownModeButtons";
import { openAuxiliaryFile } from "@/lib/auxiliaryDock";

interface AuxiliaryFileViewProps {
  projectPath: string;
  path: string;
  active: boolean;
  markdownViewMode?: MarkdownViewMode;
  onMarkdownViewModeChange?: (mode: MarkdownViewMode) => void;
}

export default function AuxiliaryFileView({
  projectPath,
  path,
  active,
  markdownViewMode,
  onMarkdownViewModeChange,
}: AuxiliaryFileViewProps) {
  return (
    <FileDocumentView
      key={`${projectPath}:${path}`}
      projectPath={projectPath}
      path={path}
      isActive={active}
      markdownViewMode={markdownViewMode}
      onMarkdownViewModeChange={onMarkdownViewModeChange}
      hideToolbar
      onOpenProjectPath={(targetPath) => openAuxiliaryFile({ projectPath, path: targetPath, preview: true })}
    />
  );
}
