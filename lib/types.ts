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

export interface AgentRow {
  id: string;
  slug: string;
  name: string;
  role: string;
  color: string;
  project_id: string | null;
  description: string | null;
  enabled: boolean;
  status: "idle" | "working" | "error";
  runtime: "api" | "chat" | "local";
  model: string;
  position: number;
  current_run_id: string | null;
  last_summary: string | null;
  last_run_at: string | null;
  /** Líder de sala: no ejecuta trabajos, coordina y firma los avisos de su proyecto */
  is_leader?: boolean;
  personality?: string | null;
  emoji?: string | null;
  frases?: string[];
}

export interface AgentRun {
  id: string;
  agent_id: string;
  status: "queued" | "running" | "paused" | "done" | "error";
  input: string;
  current_step: string | null;
  output: string | null;
  summary: string | null;
  verdict: "APROBADO" | "RECHAZADO" | null;
  cost_usd: number;
  source: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: { ideas?: { titulo: string; gancho: string; angulo: string }[]; selected?: number[]; sent?: boolean; nicho?: string } | null;
  parent_run_id?: string | null;
  video_id?: string | null;
}

export interface VideoRow {
  id: string;
  ref: number;
  titulo: string;
  estado: string;
  fase_detalle: string | null;
  modo: string;
  intentos: number;
  veredicto: string | null;
  duracion_seg: number | null;
  costo_estimado_usd: number | null;
  youtube_url: string | null;
  error: string | null;
  idea: { nicho?: string; idioma?: string; gancho?: string } | null;
  created_at: string;
  updated_at: string;
}

export const VIDEO_ESTADO: Record<string, string> = {
  guion_pendiente: "En cola para el guion",
  guionando: "Escribiendo el guion",
  cambios: "Aplicando tus cambios",
  produciendo: "Produciendo el video",
  validando: "Validando",
  revision: "Listo para que lo revises",
  publicar: "En cola para subir",
  publicando: "Subiendo a YouTube",
  publicado: "Subido en privado",
  descartado: "Descartado",
  error: "Error",
};

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
