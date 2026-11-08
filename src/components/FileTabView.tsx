import FileDocumentView from "./FileDocumentView";

interface FileTabViewProps {
  tabId: string;
  projectPath: string;
  path: string;
  isActive: boolean;
}

export default function FileTabView(props: FileTabViewProps) {
  return <FileDocumentView key={`${props.projectPath}:${props.path}`} {...props} />;
}
