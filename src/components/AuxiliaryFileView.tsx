import { Button, message } from "antd";
import { ExportOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import FileDocumentView from "@/components/FileDocumentView";
import { openInAssociatedApplication } from "@/lib/api";
import { openAuxiliaryFile } from "@/lib/auxiliaryDock";

interface AuxiliaryFileViewProps {
  projectPath: string;
  path: string;
  active: boolean;
  onPromoteToWorkspace: () => void;
}

export default function AuxiliaryFileView({
  projectPath, path, active, onPromoteToWorkspace,
}: AuxiliaryFileViewProps) {
  const { t } = useTranslation();
  return (
    <FileDocumentView
      key={`${projectPath}:${path}`}
      projectPath={projectPath}
      path={path}
      isActive={active}
      onOpenProjectPath={(targetPath) => openAuxiliaryFile({ projectPath, path: targetPath, preview: true })}
      renderActions={(save) => <>
        <Button size="small" type="text" icon={<ExportOutlined />} title={t("auxiliaryDock.openInWorkspace")} aria-label={t("auxiliaryDock.openInWorkspace")}
          onClick={() => { void (async () => {
            if (!await save()) return;
            onPromoteToWorkspace();
          })(); }}
        />
        <Button size="small" type="text" icon={<FolderOpenOutlined />} title={t("common.openInAssociatedApp")} aria-label={t("common.openInAssociatedApp")}
          onClick={() => { void openInAssociatedApplication(path).catch((reason) => { void message.error(String(reason)); }); }}
        />
      </>}
    />
  );
}
