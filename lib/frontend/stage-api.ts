import { createLiveOnboardingApi, FrontendError, type LiveApiOptions } from './api';
import type { DailyResponse, HomeResponse, OnboardingApi, ProfileResponse } from './types';
import type { FactorKey } from './factor-preview';
import { finite, isoDate, nonnegative, record, rows, safeText, safeUrl, scoreNumber, severity, textList, timestamp } from './stage-values';

export interface HistoryEntry {
  date: string; score: number | null; air: string; uv: string; pollen: string; mold: string;
  values: { aqi: number | null; uv_index: number | null; pollen: { tree: number | null; grass: number | null; weed: number | null }; mold_risk: string | null };
}
export interface HistoryResponse { from: string; to: string; count: number; history: HistoryEntry[] }
export interface SourceLink { label: string; url: string; retrieved: string | null }
export interface LearnContent {
  topic: FactorKey; locale: string; title: string; what_it_is: string;
  why_yours: string | null; household_note: string | null; protect: string[]; sources: SourceLink[];
}
export type LearnResponse = LearnContent;
export interface AssistantSuggestions { suggestions: string[]; disclaimer: string; sends_household_context?: boolean }
export interface AssistantResponse {
  answer: string | null; message: string | null; declined: boolean; configured: boolean | null;
  reason: 'no_source' | 'unavailable' | null; grounded: boolean; uses_household_data: boolean;
  citations: (SourceLink & { n: number })[]; disclaimer: string;
}
export interface StageAlert { id: string; type: string; severity: string; title: string; message: string; fired_at: string | null; read: boolean; dismissed: boolean }
export interface AlertsResponse { count: number; unread: number; alerts: StageAlert[] }
export type AlertMutation = { id: string; dismissed?: boolean } | { all: true };
export interface LiveStageApi extends OnboardingApi {
  loadProfile(signal?: AbortSignal): Promise<ProfileResponse>;
  getHistory(days?: number, signal?: AbortSignal): Promise<HistoryResponse>;
  getLearn(topic: FactorKey, context?: Record<string, string | number>, signal?: AbortSignal): Promise<LearnContent>;
  getAssistantSuggestions(page?: string, signal?: AbortSignal): Promise<AssistantSuggestions>;
  getAssistant(page?: string, signal?: AbortSignal): Promise<AssistantSuggestions>;
  askAssistant(question: string, page?: string, signal?: AbortSignal): Promise<AssistantResponse>;
  getAlerts(signal?: AbortSignal): Promise<AlertsResponse>;
  markAlerts(change: AlertMutation, signal?: AbortSignal): Promise<{ ok: true; updated: number }>;
}
export interface StageApiOptions extends LiveApiOptions { assistantTimeoutMs?: number }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const topics: FactorKey[] = ['air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead'];
const pages = ['today', 'home', 'homeguard', 'map', 'journal', 'act', 'settings', 'learn'];
const pageToken = (page: string) => pages.includes(page) ? page : 'today';
const invalid = (): never => { throw new FrontendError('invalid_response'); };
const nullableText = (value: unknown) => safeText(value) || null;
function source(value: Record<string, unknown>): SourceLink | null {
  const url = safeUrl(value.url); const label = safeText(value.label);
  return url && label ? { url, label, retrieved: isoDate(value.retrieved) ?? timestamp(value.retrieved) } : null;
}
function objectFields(value: unknown, keys: string[]): Record<string, unknown> {
  const result = record(value);
  if (!keys.some(key => key in result)) invalid();
  for (const key of keys) if (result[key] !== null && result[key] !== undefined && (typeof result[key] !== 'object' || Array.isArray(result[key]))) invalid();
  return result;
}
export function parseHistory(value: unknown): HistoryResponse {
  const body = record(value); const from = isoDate(body.from); const to = isoDate(body.to);
  if (!from || !to || !Array.isArray(body.history)) return invalid();
  const history = rows(body.history).flatMap(row => {
    const date = isoDate(row.date); if (!date || date < from || date > to) return [];
    const values = record(row.values); const pollen = record(values.pollen);
    return [{ date, score: scoreNumber(row.score), air: severity(row.air), uv: severity(row.uv), pollen: severity(row.pollen), mold: severity(row.mold), values: {
      aqi: nonnegative(values.aqi), uv_index: nonnegative(values.uv_index),
      pollen: { tree: nonnegative(pollen.tree), grass: nonnegative(pollen.grass), weed: nonnegative(pollen.weed) },
      mold_risk: ['low', 'moderate', 'high'].includes(String(values.mold_risk)) ? String(values.mold_risk) : null,
    } }];
  });
  return { from, to, count: history.length, history };
}
export function parseLearn(value: unknown, topic: FactorKey): LearnContent {
  const body = record(value);
  if (body.topic !== topic || typeof body.what_it_is !== 'string' || !Array.isArray(body.protect) || !Array.isArray(body.sources)) return invalid();
  return { topic, locale: safeText(body.locale, 'en'), title: safeText(body.title), what_it_is: safeText(body.what_it_is), why_yours: nullableText(body.why_yours), household_note: nullableText(body.household_note), protect: textList(body.protect), sources: rows(body.sources).map(source).filter((item): item is SourceLink => item !== null) };
}
export function parseAssistant(value: unknown): AssistantResponse {
  const body = record(value);
  if (typeof body.disclaimer !== 'string' || !Array.isArray(body.citations)) return invalid();
  const answer = nullableText(body.answer); const message = nullableText(body.message);
  const declined = body.declined === true;
  const reason = body.reason === 'unavailable' || body.reason === 'no_source' ? body.reason : null;
  if (!answer && !message) return invalid();
  // An answer is publishable only when the server explicitly confirms grounding.
  if (answer && body.grounded !== true) return invalid();
  const citations = rows(body.citations).flatMap(item => {
    const entry = source(item); const n = finite(item.n);
    return entry && n !== null && Number.isInteger(n) && n > 0 ? [{ ...entry, n }] : [];
  });
  if (answer && citations.length === 0 && body.uses_household_data !== true) return invalid();
  return { answer, message, declined, reason, configured: typeof body.configured === 'boolean' ? body.configured : null, grounded: body.grounded === true, uses_household_data: body.uses_household_data === true, citations, disclaimer: safeText(body.disclaimer) };
}
/** All live calls share the existing identity-checked transport. No direct fetch,
 * backend import, or anonymous session creation occurs at factory construction. */
export function createLiveStageApi(options: StageApiOptions = {}): LiveStageApi {
  const base = createLiveOnboardingApi({ ...options, validateReading(kind, payload) {
    objectFields(payload, kind === 'daily' ? ['air', 'uv', 'pollen', 'mold', 'score'] : ['water', 'radon', 'score', 'lead']);
    options.validateReading?.(kind, payload);
  } });
  const getProfile = async (signal?: AbortSignal) => {
    const profile = await base.getProfile(signal);
    if (typeof profile.onboarded !== 'boolean' && typeof profile.onboarding_complete !== 'boolean') invalid();
    return profile;
  };
  const getAssistant = async (page = 'today', signal?: AbortSignal): Promise<AssistantSuggestions> => {
    const body = record(await base.request(`/api/assistant?page=${pageToken(page)}`, {}, signal));
    if (!Array.isArray(body.suggestions) || typeof body.disclaimer !== 'string') invalid();
    return { suggestions: textList(body.suggestions), disclaimer: safeText(body.disclaimer), ...(typeof body.sends_household_context === 'boolean' ? { sends_household_context: body.sends_household_context } : {}) };
  };
  return {
    ...base, getProfile, loadProfile: getProfile,
    async getDaily(signal, requestOptions) { const data = await base.getDaily(signal, requestOptions); objectFields(data, ['air', 'uv', 'pollen', 'mold', 'score']); return data as DailyResponse; },
    async getHome(signal) { const data = await base.getHome(signal); objectFields(data, ['water', 'radon', 'score', 'lead']); return data as HomeResponse; },
    async getHistory(days = 7, signal) { const limit = Number.isFinite(days) ? Math.min(365, Math.max(1, Math.floor(days))) : 7; return parseHistory(await base.request(`/api/history?days=${limit}`, {}, signal)); },
    async getLearn(topic, context = {}, signal) {
      if (!topics.includes(topic)) return invalid();
      const query = new URLSearchParams({ topic });
      const keys = ['locale', 'value', 'severity', 'contaminant', 'limit', 'county', 'zone', 'home_year', 'source', 'pollutant', 'peak_start', 'peak_end', 'category', 'risk', 'humidity', 'precip'];
      for (const key of keys) { const value = context[key]; if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) query.set(key, String(value)); }
      return parseLearn(await base.request(`/api/learn?${query}`, {}, signal), topic);
    },
    getAssistantSuggestions: getAssistant, getAssistant,
    async askAssistant(question, page = 'today', signal) {
      const trimmed = question.trim(); if (!trimmed || trimmed.length > 1000) return invalid();
      return parseAssistant(await base.request('/api/assistant', { method: 'POST', body: JSON.stringify({ question: trimmed, page: pageToken(page) }) }, signal, undefined, options.assistantTimeoutMs ?? 60000));
    },
    async getAlerts(signal) {
      const body = record(await base.request('/api/alerts', {}, signal));
      if (!Array.isArray(body.alerts)) return invalid();
      const alerts = rows(body.alerts).filter(row => typeof row.id === 'string' && UUID.test(row.id) && row.dismissed !== true).map(row => ({ id: row.id as string, type: safeText(row.type), severity: severity(row.severity), title: safeText(row.title), message: safeText(row.message), fired_at: timestamp(row.fired_at), read: row.read === true, dismissed: false }));
      return { count: alerts.length, unread: alerts.filter(alert => !alert.read).length, alerts };
    },
    async markAlerts(change, signal) {
      let payload: AlertMutation;
      if ('all' in change && change.all === true) payload = { all: true };
      else if ('id' in change && UUID.test(change.id)) payload = { id: change.id, ...(typeof change.dismissed === 'boolean' ? { dismissed: change.dismissed } : {}) };
      else return invalid();
      const body = record(await base.request('/api/alerts', { method: 'POST', body: JSON.stringify(payload) }, signal));
      const updated = nonnegative(body.updated);
      if (body.ok !== true || updated === null || !Number.isInteger(updated)) return invalid();
      return { ok: true, updated };
    },
  };
}
