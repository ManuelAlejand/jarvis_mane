export type TaskStatus = "backlog" | "en_curso" | "bloqueada" | "hecha";
export type ProjectStatus = "idea" | "activo" | "pausado" | "terminado";
export type ProjectScope = "youtube_shorts" | "system_automations" | "crm_communications" | "core";

export interface Project {
  id: string;
  slug: string;
  name: string;
  scope: ProjectScope;
  status: ProjectStatus;
  summary: string | null;
  progress: number;
  updated_at: string;
}

export interface Task {
  id: string;
  ref: number;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  assignee: string | null;
  tags: string[];
  due_date: string | null;
  position: number;
  updated_at: string;
}

export interface LogRow {
  id: number;
  level: string;
  source: string;
  message: string;
  created_at: string;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  en_curso: "En curso",
  bloqueada: "Bloqueada",
  hecha: "Hecha",
};

export const SCOPE_LABEL: Record<ProjectScope, string> = {
  core: "Core",
  youtube_shorts: "YouTube Shorts",
  system_automations: "Automatizaciones",
  crm_communications: "CRM y Comunicaciones",
};
