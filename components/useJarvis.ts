"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import type { LogRow, Project, Task } from "@/lib/types";

export interface Profile {
  id: string;
  full_name: string | null;
  role: "admin" | "member";
}

/** Carga todo el estado del dashboard y lo mantiene vivo con Supabase Realtime. 0 tokens de IA. */
export function useJarvis(userId: string) {
  const db = browserClient();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [spend, setSpend] = useState({ spent: 0, budget: 5 });
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const [p, t, l, pr, s, b] = await Promise.all([
      db.from("projects").select("*").order("created_at"),
      db.from("tasks").select("*").order("position").order("ref"),
      db.from("execution_logs").select("id,level,source,message,created_at").order("created_at", { ascending: false }).limit(60),
      db.from("profiles").select("id,full_name,role"),
      db.from("api_spend_month").select("spent_usd").maybeSingle(),
      db.from("settings").select("value").eq("key", "api_budget_usd").maybeSingle(),
    ]);
    const firstErr = [p, t, l, pr].find((r) => r.error)?.error;
    setError(firstErr ? firstErr.message : null);
    setProjects((p.data ?? []) as Project[]);
    setTasks((t.data ?? []) as Task[]);
    setLogs((l.data ?? []) as LogRow[]);
    setProfiles((pr.data ?? []) as Profile[]);
    setSpend({ spent: Number(s.data?.spent_usd ?? 0), budget: Number(b.data?.value ?? 5) });
    setLoading(false);
  }, [db]);

  useEffect(() => {
    load();
    // Agrupa ráfagas de cambios en una sola recarga
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, 250);
    };
    const channel = db
      .channel("jarvis-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "execution_logs" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "api_usage" }, refresh)
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      db.removeChannel(channel);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [db, load]);

  const me = profiles.find((p) => p.id === userId) ?? null;

  const updateTask = useCallback(
    async (id: string, patch: Partial<Task>) => {
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t))); // optimista
      const { error } = await db.from("tasks").update(patch).eq("id", id);
      if (error) {
        setError(error.message.includes("row-level") ? "No tienes permiso para editar esa tarea." : error.message);
        load();
      }
    },
    [db, load],
  );

  const createTask = useCallback(
    async (input: { title: string; project_id: string; priority: number }) => {
      const { error } = await db.from("tasks").insert({ ...input, assignee: userId });
      if (error) setError(error.message);
      else load();
      return !error;
    },
    [db, load, userId],
  );

  return { projects, tasks, logs, profiles, spend, loading, live, error, setError, me, updateTask, createTask, reload: load };
}

export type JarvisState = ReturnType<typeof useJarvis>;

export function projectProgress(projectId: string, tasks: Task[], fallback: number) {
  const mine = tasks.filter((t) => t.project_id === projectId);
  if (!mine.length) return fallback;
  return Math.round((mine.filter((t) => t.status === "hecha").length / mine.length) * 100);
}
