import {
  AppWindow,
  Binary,
  Bot,
  BrainCircuit,
  Cpu,
  Database,
  Filter,
  Network,
  PenTool,
  Smartphone,
  Sparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";

// Keyed by TECH_AREAS keys in lib/application-profile.ts.
const ICONS: Record<string, LucideIcon> = {
  machine_learning: BrainCircuit,
  ai_automation: Workflow,
  hardware: Cpu,
  frontend: AppWindow,
  mobile: Smartphone,
  data_cleaning: Filter,
  design: PenTool,
  backend_algos: Binary,
  system_design: Network,
  data_engineering: Database,
  nlp_llm: Bot,
};

export function TechAreaIcon({ areaKey, size = 15, className }: { areaKey: string; size?: number; className?: string }) {
  const Icon = ICONS[areaKey] ?? Sparkles;
  return <Icon size={size} className={className} aria-hidden />;
}
