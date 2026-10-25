export type User = {
  id: number;
  username: string;
  display_name: string;
  default_model: string;
};

export type Overview = {
  mode: string;
  conversations: number;
  dashboard_messages: number;
  agent_sessions: number;
  agent_tokens: { input: number; output: number };
  agent_sessions_unavailable?: boolean;
  skills: { total: number; enabled: number };
  cronjobs: { total: number; active: number };
  cron_error: string;
  model: { default_model: string; provider: string; base_url: string; has_api_key: boolean };
  recent_sessions: SessionRow[];
  recent_executions: CronExecution[];
  last_health: Record<string, { status: string; ts: number }>;
};

export type SessionRow = {
  id: string;
  source: string;
  title: string;
  model: string;
  started_at: number | null;
  last_activity_at: number | null;
  message_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd?: number | null;
};

export type CronExecution = {
  id: string;
  job_id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  scheduled_instant: string | null;
};

export type Conversation = {
  id: string;
  title: string;
  hermes_session_id: string | null;
  model: string;
  created_at: number;
  updated_at: number;
  message_count?: number;
};

export type ChatMessage = {
  id: number;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  status: "done" | "pending" | "running" | "error" | "stopped";
  error: string | null;
  model: string;
  hermes_session_id: string | null;
  created_at: number;
  finished_at: number | null;
};

export type Skill = {
  name: string;
  slug: string;
  description: string;
  category: string;
  path: string;
  status: "enabled" | "disabled" | "unknown";
};

export type SkillDetail = Skill & { content: string };

export type CronJob = {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  status: string;
  enabled: boolean;
  next_run: string | null;
  last_run: string | null;
  last_status: string | null;
  last_error: string | null;
  deliver: string;
  created_at: string | null;
  paused_reason: string | null;
};

export type ModelsPayload = {
  config: {
    default_model: string;
    provider: string;
    base_url: string;
    has_api_key: boolean;
  };
  providers: {
    provider: string;
    base_url: string;
    models: string[];
    fetched_at: number | null;
    age_hours: number | null;
  }[];
};

export type HealthService = {
  name: string;
  status: "operational" | "degraded" | "offline" | "unknown";
  latency_ms: number | null;
  detail: string;
};

export type SystemStatus = {
  checked_at: number;
  overall: string;
  mode: string;
  services: HealthService[];
};

export type ActivityItem = {
  kind: "session" | "chat" | "cron";
  id: string;
  title: string;
  status: string;
  ts: number | null;
  source?: string;
  model?: string;
  message_count?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  job_id?: string;
  error?: string | null;
};

export type SchedulePreview = {
  valid: boolean;
  kind: string | null;
  next: string[];
  error?: string;
};
