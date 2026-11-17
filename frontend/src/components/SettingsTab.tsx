import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  HardDrive,
  RefreshCw,
  Save,
  Server,
  Webhook,
  Zap,
} from 'lucide-react';
import { engramApi } from '../api/client';
import { Dictionary } from '../i18n';
import { SettingsPayload } from '../types/engram';
import { CustomSelect } from './ui/CustomSelect';

interface SettingsTabProps {
  settings: SettingsPayload;
  dict: Dictionary;
  onRefresh: () => Promise<void>;
}

const LOCAL_MODEL_OPTIONS = [
  {
    value: 'BAAI/bge-small-en-v1.5',
    label: 'BAAI/bge-small-en-v1.5',
    sublabel: 'FastEmbed ONNX • ~130MB RAM',
    badge: '384d',
  },
  {
    value: 'sentence-transformers/all-MiniLM-L6-v2',
    label: 'all-MiniLM-L6-v2',
    sublabel: 'Lightweight ONNX • ~90MB RAM',
    badge: '384d',
  },
  {
    value: 'BAAI/bge-large-en-v1.5',
    label: 'BAAI/bge-large-en-v1.5',
    sublabel: 'High-precision ONNX • ~390MB RAM',
    badge: '1024d',
  },
];

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  dict,
  onRefresh,
}) => {
  const [form, setForm] = useState<SettingsPayload>(settings);
  const [saving, setSaving] = useState(false);
  const [saveBanner, setSaveBanner] = useState<string | null>(null);

  const [testingLlm, setTestingLlm] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<{
    ok: boolean;
    latency_ms: number;
    response_preview: string;
  } | null>(null);

  const [testingEmbedding, setTestingEmbedding] = useState(false);
  const [embedTestResult, setEmbedTestResult] = useState<{
    ok: boolean;
    detected_dimension: number;
    current_vec_dimension: number;
    dimension_mismatch: boolean;
    latency_ms: number;
    model: string;
  } | null>(null);

  const [reindexing, setReindexing] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await engramApi.updateSettings({
        llm_base_url: form.llm_base_url,
        llm_api_key: form.llm_api_key,
        llm_model: form.llm_model,
        embedding_mode: form.embedding_mode,
        embedding_base_url: form.embedding_base_url,
        embedding_api_key: form.embedding_api_key,
        embedding_model: form.embedding_model,
        embedding_dimension: Number(form.embedding_dimension),
        local_embedding_model: form.local_embedding_model,
        auto_ingest_enabled: form.auto_ingest_enabled,
      });
      setForm(res.settings);
      await onRefresh();
      setSaveBanner(
        res.settings.embedding_mode === 'external'
          ? 'Settings saved • Local FastEmbed ONNX unloaded (gc.collect() -> 0 MB RAM overhead)'
          : 'Settings saved • Local In-Container FastEmbed ONNX mode active'
      );
      setTimeout(() => setSaveBanner(null), 4500);
    } finally {
      setSaving(false);
    }
  };

  const handleTestLlm = async () => {
    setTestingLlm(true);
    try {
      const res = await engramApi.testLlm({
        llm_base_url: form.llm_base_url,
        llm_api_key: form.llm_api_key,
        llm_model: form.llm_model,
      });
      setLlmTestResult(res);
    } finally {
      setTestingLlm(false);
    }
  };

  const handleTestEmbedding = async () => {
    setTestingEmbedding(true);
    try {
      const res = await engramApi.testEmbedding({
        embedding_mode: form.embedding_mode,
        embedding_base_url: form.embedding_base_url,
        embedding_api_key: form.embedding_api_key,
        embedding_model: form.embedding_model,
        local_embedding_model: form.local_embedding_model,
      });
      setEmbedTestResult(res);
      setForm((prev) => ({
        ...prev,
        embedding_dimension: res.detected_dimension,
        dimension_mismatch: res.detected_dimension !== prev.current_vec_dimension,
      }));
    } finally {
      setTestingEmbedding(false);
    }
  };

  const handleReindex = async () => {
    setReindexing(true);
    try {
      const targetDim = embedTestResult?.detected_dimension || form.embedding_dimension;
      const res = await engramApi.triggerReindex(targetDim);
      setForm((prev) => ({
        ...prev,
        current_vec_dimension: res.target_dimension,
        embedding_dimension: res.target_dimension,
        dimension_mismatch: false,
        reindex_status: res.reindex_status,
      }));
      if (embedTestResult) {
        setEmbedTestResult({
          ...embedTestResult,
          current_vec_dimension: res.target_dimension,
          dimension_mismatch: false,
        });
      }
      await onRefresh();
      setSaveBanner(
        `Re-indexed ${res.reindex_status.processed}/${res.reindex_status.total} memories into vec0 float[${res.target_dimension}] table.`
      );
      setTimeout(() => setSaveBanner(null), 4500);
    } finally {
      setReindexing(false);
    }
  };

  const hasDimensionMismatch =
    form.dimension_mismatch ||
    Number(form.embedding_dimension) !== form.current_vec_dimension ||
    Boolean(embedTestResult?.dimension_mismatch);

  const curlSnippet = `curl -X POST http://localhost:8080/api/v1/ingest \\
  -H "Authorization: Bearer $MCP_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspace": "hermes",
    "messages": [
      {"role": "user", "content": "Always batch settlements under 100 items."},
      {"role": "assistant", "content": "Noted as a procedural rule for Hermes."}
    ]
  }'`;

  const handleCopyCurl = () => {
    navigator.clipboard.writeText(curlSnippet);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1
            className="text-xl font-bold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            {dict.settings.title}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {dict.settings.subtitle}
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="h-8 px-4 reui-btn-primary text-xs flex items-center gap-2 self-start sm:self-auto whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Save className="w-3.5 h-3.5 shrink-0" />
          <span>{saving ? dict.settings.savingBtn : dict.settings.saveBtn}</span>
        </button>
      </div>

      {saveBanner && (
        <div className="px-3.5 py-2.5 rounded-[4px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-mono-data flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{saveBanner}</span>
        </div>
      )}

      {/* Card 1: Reasoning & Distillation LLM */}
      <div className="p-5 reui-card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 hairline-border-b">
          <div>
            <h2
              className="text-sm font-semibold flex items-center gap-2"
              style={{ color: 'var(--text-primary)' }}
            >
              <Cpu className="w-4 h-4 shrink-0 text-emerald-400" />
              {dict.settings.card1.title}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {dict.settings.card1.subtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={handleTestLlm}
            disabled={testingLlm}
            className="h-7 px-3 reui-btn-secondary text-xs flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{testingLlm ? 'Testing...' : dict.settings.card1.testBtn}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label
              className="block text-[11px] font-medium mb-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              {dict.settings.card1.baseUrl}
            </label>
            <input
              type="text"
              value={form.llm_base_url}
              onChange={(e) => setForm({ ...form, llm_base_url: e.target.value })}
              className="w-full px-3 py-2 rounded-lg hairline-border font-mono-data text-xs focus:outline-none focus:ring-1 focus:ring-[#1E6F5C]/50"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label
              className="block text-[11px] font-medium mb-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              {dict.settings.card1.apiKey}
            </label>
            <input
              type="password"
              value={form.llm_api_key}
              onChange={(e) => setForm({ ...form, llm_api_key: e.target.value })}
              className="w-full px-3 py-2 rounded-lg hairline-border font-mono-data text-xs focus:outline-none focus:ring-1 focus:ring-[#1E6F5C]/50"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label
              className="block text-[11px] font-medium mb-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              {dict.settings.card1.modelName}
            </label>
            <input
              type="text"
              value={form.llm_model}
              onChange={(e) => setForm({ ...form, llm_model: e.target.value })}
              className="w-full px-3 py-2 rounded-lg hairline-border font-mono-data text-xs focus:outline-none focus:ring-1 focus:ring-[#1E6F5C]/50"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {llmTestResult && (
          <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 font-mono-data text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
            <span>✓ {llmTestResult.response_preview}</span>
            <span>{llmTestResult.latency_ms}ms</span>
          </div>
        )}
      </div>

      {/* Card 2: Embedding Provider (Zero-RAM Switcher) */}
      <div className="p-5 reui-card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 hairline-border-b">
          <div>
            <h2
              className="text-sm font-semibold flex items-center gap-2"
              style={{ color: 'var(--text-primary)' }}
            >
              <Server className="w-4 h-4 text-emerald-400" />
              {dict.settings.card2.title}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {dict.settings.card2.subtitle}
            </p>
          </div>

          <span
            className="font-mono-data text-[11px] px-2.5 py-1 rounded-[4px] hairline-border"
            style={{ backgroundColor: 'var(--bg-elevated)' }}
          >
            Active Table:{' '}
            <strong className="text-emerald-400">
              vec_memories float[{form.current_vec_dimension}]
            </strong>
          </span>
        </div>

        {/* Segmented Mode Switcher */}
        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-1 rounded-[4px] hairline-border"
          style={{ backgroundColor: 'var(--bg-elevated)' }}
        >
          <button
            type="button"
            onClick={() =>
              setForm({
                ...form,
                embedding_mode: 'external',
                embedding_dimension: 1536,
                dimension_mismatch: 1536 !== form.current_vec_dimension,
              })
            }
            className={`py-2 px-3 rounded-[3px] text-xs font-medium flex items-center justify-center gap-2 transition-all cursor-pointer ${
              form.embedding_mode === 'external' ? 'reui-btn-primary' : ''
            }`}
            style={
              form.embedding_mode !== 'external' ? { color: 'var(--text-secondary)' } : undefined
            }
          >
            <Server className="w-3.5 h-3.5" />
            {dict.settings.card2.externalTab}
          </button>

          <button
            type="button"
            onClick={() =>
              setForm({
                ...form,
                embedding_mode: 'local',
                embedding_dimension: 384,
                dimension_mismatch: 384 !== form.current_vec_dimension,
              })
            }
            className={`py-2 px-3 rounded-[3px] text-xs font-medium flex items-center justify-center gap-2 transition-all cursor-pointer ${
              form.embedding_mode === 'local' ? 'reui-btn-primary' : ''
            }`}
            style={
              form.embedding_mode !== 'local' ? { color: 'var(--text-secondary)' } : undefined
            }
          >
            <HardDrive className="w-3.5 h-3.5" />
            {dict.settings.card2.localTab}
          </button>
        </div>

        {form.embedding_mode === 'external' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <label
                className="block text-[11px] font-medium mb-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                {dict.settings.card2.baseUrl}
              </label>
              <input
                type="text"
                value={form.embedding_base_url}
                onChange={(e) => setForm({ ...form, embedding_base_url: e.target.value })}
                className="w-full px-3 py-2 rounded-lg hairline-border font-mono-data text-xs focus:outline-none"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              />
            </div>

            <div>
              <label
                className="block text-[11px] font-medium mb-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                {dict.settings.card2.apiKey}
              </label>
              <input
                type="password"
                value={form.embedding_api_key}
                onChange={(e) => setForm({ ...form, embedding_api_key: e.target.value })}
                className="w-full px-3 py-2 rounded-lg hairline-border font-mono-data text-xs focus:outline-none"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              />
            </div>

            <div>
              <label
                className="block text-[11px] font-medium mb-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                {dict.settings.card2.modelName}
              </label>
              <input
                type="text"
                value={form.embedding_model}
                onChange={(e) => setForm({ ...form, embedding_model: e.target.value })}
                className="w-full px-3 py-2 rounded-lg hairline-border font-mono-data text-xs focus:outline-none"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              />
            </div>

            <div>
              <label
                className="block text-[11px] font-medium mb-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                {dict.settings.card2.dimension}
              </label>
              <input
                type="number"
                value={form.embedding_dimension}
                onChange={(e) => {
                  const nextDim = Number(e.target.value);
                  setForm({
                    ...form,
                    embedding_dimension: nextDim,
                    dimension_mismatch: nextDim !== form.current_vec_dimension,
                  });
                }}
                className="w-full px-3 py-2 rounded-lg hairline-border font-mono-data text-xs focus:outline-none"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <CustomSelect
              label={dict.settings.card2.localModel}
              value={form.local_embedding_model}
              options={LOCAL_MODEL_OPTIONS}
              mono
              onChange={(model) => {
                const dim = model.includes('large') ? 1024 : 384;
                setForm({
                  ...form,
                  local_embedding_model: model,
                  embedding_dimension: dim,
                  dimension_mismatch: dim !== form.current_vec_dimension,
                });
              }}
            />

            <div>
              <label
                className="block text-[11px] font-medium mb-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                {dict.settings.card2.localCacheDir}
              </label>
              <input
                type="text"
                readOnly
                value={form.local_models_dir}
                className="w-full px-3 py-2 rounded-lg hairline-border font-mono-data text-xs opacity-80"
                style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
              />
            </div>

            <div>
              <label
                className="block text-[11px] font-medium mb-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                Lazy Import Policy (Rule 5)
              </label>
              <div
                className="px-3 py-2 rounded-lg hairline-border font-mono-data text-xs font-semibold"
                style={{
                  backgroundColor: 'var(--bg-tag-teal)',
                  color: 'var(--text-tag-teal)',
                }}
              >
                _get_local_embedder() + gc.collect()
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={handleTestEmbedding}
            disabled={testingEmbedding}
            className="h-8 px-3.5 reui-btn-secondary text-xs flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
            <span>
              {testingEmbedding ? 'Detecting Dimension...' : dict.settings.card2.testDetectBtn}
            </span>
          </button>

          {embedTestResult && (
            <div className="font-mono-data text-xs px-3 py-1.5 rounded-[4px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
              Connected • {embedTestResult.latency_ms}ms • {embedTestResult.detected_dimension}d (
              {embedTestResult.model})
            </div>
          )}
        </div>

        {hasDimensionMismatch && (
          <div className="p-4 rounded-[4px] border border-amber-500/40 bg-amber-500/10 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xs font-bold text-amber-300">
                    {dict.settings.card2.mismatchTitle} ({form.current_vec_dimension}d →{' '}
                    {form.embedding_dimension}d)
                  </h3>
                  <p className="text-[11px] text-amber-200/80 mt-0.5">
                    {dict.settings.card2.mismatchDesc}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleReindex}
                disabled={reindexing}
                className="px-3.5 py-2 rounded-[4px] text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${reindexing ? 'animate-spin' : ''}`} />
                <span>{reindexing ? 'Re-indexing...' : dict.settings.card2.reindexBtn}</span>
              </button>
            </div>
          </div>
        )}

        <div
          className="p-3 rounded-[4px] hairline-border space-y-2"
          style={{ backgroundColor: 'var(--bg-elevated)' }}
        >
          <div className="flex items-center justify-between gap-2 font-mono-data text-[11px]">
            <span style={{ color: 'var(--text-secondary)' }}>
              Vector Index Status: {form.reindex_status.processed}/{form.reindex_status.total}{' '}
              memories indexed ({form.reindex_status.dimension}d)
            </span>
            <button
              type="button"
              onClick={handleReindex}
              disabled={reindexing}
              className="hover:underline flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer font-semibold text-emerald-400"
            >
              <RefreshCw className={`w-3 h-3 shrink-0 ${reindexing ? 'animate-spin' : ''}`} />
              <span>{dict.settings.card2.reindexBtn}</span>
            </button>
          </div>
          <div className="w-full h-2 rounded-[2px] reui-hatch-track overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{
                width: `${
                  form.reindex_status.total > 0
                    ? Math.round(
                        (form.reindex_status.processed / form.reindex_status.total) * 100
                      )
                    : 100
                }%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Card 3: Automation & Webhook Ingestion (/api/v1/ingest) */}
      <div className="p-5 reui-card space-y-4">
        <div className="flex items-center justify-between gap-3 pb-3 hairline-border-b">
          <div>
            <h2
              className="text-sm font-bold flex items-center gap-2"
              style={{ color: 'var(--text-primary)' }}
            >
              <Webhook className="w-4 h-4" style={{ color: 'var(--accent-teal)' }} />
              {dict.settings.card3.title}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {dict.settings.card3.subtitle}
            </p>
          </div>

          <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.auto_ingest_enabled}
              onChange={(e) => setForm({ ...form, auto_ingest_enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-10 h-5 bg-slate-400 rounded-full peer peer-checked:bg-[#1B4332] relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
            <span className="font-mono-data text-xs font-semibold">
              {form.auto_ingest_enabled ? 'ENABLED (202)' : 'DISABLED (403)'}
            </span>
          </label>
        </div>

        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {form.auto_ingest_enabled
            ? dict.settings.card3.enabledDesc
            : dict.settings.card3.disabledDesc}
        </p>

        {form.auto_ingest_enabled && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span
                className="font-mono-data text-[11px] font-semibold"
                style={{ color: 'var(--accent-teal)' }}
              >
                POST http://localhost:8080/api/v1/ingest
              </span>
              <button
                type="button"
                onClick={handleCopyCurl}
                className="px-2.5 py-1 rounded-lg console-card font-mono-data text-[11px] flex items-center gap-1 cursor-pointer"
                style={{ color: 'var(--text-secondary)' }}
              >
                {copiedCurl ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                {copiedCurl ? 'Copied' : 'Copy cURL'}
              </button>
            </div>
            <pre
              className="p-3.5 rounded-xl hairline-border font-mono-data text-xs overflow-x-auto"
              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
            >
              {curlSnippet}
            </pre>
          </div>
        )}
      </div>
    </form>
  );
};
