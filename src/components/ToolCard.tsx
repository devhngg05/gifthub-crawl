import type { ToolRow } from "@/db/schema";

export interface ToolCardProps {
  tool: ToolRow;
}

export function ToolCard(props: ToolCardProps) {
  void props;
  return <article />;
}
