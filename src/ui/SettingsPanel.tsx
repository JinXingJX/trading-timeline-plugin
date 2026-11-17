import type { ModelListResponse, ModelSelection } from "@daily/plugin-sdk";
import { Database, LoaderCircle, Plus, ShieldCheck, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { dailyHost } from "../host";
import { createSource, MAX_SOURCES, SOURCE_PRESETS } from "../domain/normalize";
import { createId } from "../domain/values";
import type { ImpactLevel, TimelineSettings, TimelineSource } from "../types";
import { useDialogFocus } from "./useDialogFocus";

export function SettingsPanel({
  error,
  draft,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  error: string | null;
  draft: TimelineSettings;
  busy: boolean;
  onChange: (settings: TimelineSettings) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const panelRef = useDialogFocus<HTMLDivElement>(onClose);
  const [models, setModels] = useState<ModelListResponse | null>(null);
  useEffect(() => {
    let alive = true;
    // Older hosts lack model.list; the pickers then only offer the default.
    dailyHost().model.list().then((listed) => { if (alive) setModels(listed); }, () => undefined);
    return () => { alive = false; };
  }, []);
  function updateSource(sourceId: string, patch: Partial<TimelineSource>) {
    onChange({ ...draft, sources: draft.sources.map((source) => source.id === sourceId ? { ...source, ...patch } : source) });
  }
  function addSource(source: TimelineSource) {
    onChange({ ...draft, sources: [...draft.sources, source] });
  }
  const availablePresets = SOURCE_PRESETS.filter((preset) => !draft.sources.some((source) => source.id === preset.id));
  const full = draft.sources.length >= MAX_SOURCES;
  return (
    <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-labelledby="timeline-settings-title">
      <div ref={panelRef} className="panel settings-panel">
        <div className="panel-header"><div><h2 id="timeline-settings-title">自动化设置</h2><span>扫描频率、分析时机与数据源</span></div><button className="icon-button" title="关闭 Esc" aria-label="关闭自动化设置" onClick={onClose}><X size={18} /></button></div>
        <div className="panel-body">
          {error ? <div className="tl-notice error inline" role="alert">{error}</div> : null}
          <label className="field full"><span>关注资产 <small>用逗号分隔</small></span><input value={draft.watchlist.join(", ")} onChange={(event) => onChange({ ...draft, watchlist: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })} /></label>
          <div className="field-grid">
            <label className="field"><span>扫描间隔</span><select value={draft.discoveryIntervalMinutes} onChange={(event) => onChange({ ...draft, discoveryIntervalMinutes: Number(event.target.value) })}><option value={15}>15 分钟</option><option value={30}>30 分钟</option><option value={60}>1 小时</option><option value={180}>3 小时</option><option value={720}>12 小时</option></select></label>
            <label className="field"><span>到点后等待</span><select value={draft.analysisDelayMinutes} onChange={(event) => onChange({ ...draft, analysisDelayMinutes: Number(event.target.value) })}><option value={0}>立即分析</option><option value={5}>5 分钟</option><option value={10}>10 分钟</option><option value={30}>30 分钟</option><option value={60}>1 小时</option></select></label>
            <label className="field"><span>最低影响级别</span><select value={draft.minimumImpact} onChange={(event) => onChange({ ...draft, minimumImpact: event.target.value as ImpactLevel })}><option value="high">仅高影响</option><option value="medium">中影响及以上</option><option value="low">全部事件</option></select></label>
            <label className="field"><span>时区</span><input value={draft.timezone} onChange={(event) => onChange({ ...draft, timezone: event.target.value })} /></label>
            <label className="field"><span>扫描模型</span><ModelSelect models={models} value={draft.discoveryModel} onChange={(discoveryModel) => onChange({ ...draft, discoveryModel })} /></label>
            <label className="field"><span>分析模型</span><ModelSelect models={models} value={draft.analysisModel} onChange={(analysisModel) => onChange({ ...draft, analysisModel })} /></label>
          </div>

          <div className="sources-editor">
            <div className="editor-heading"><div><Database size={15} /><span>RSS / Atom / JSON 数据源</span></div><div className="source-add">
              {availablePresets.length > 0 && (
                <select
                  className="preset-select"
                  aria-label="从预制数据源添加"
                  value=""
                  disabled={full}
                  onChange={(event) => {
                    const preset = availablePresets.find((item) => item.id === event.target.value);
                    // Presets are added enabled; the user picked them explicitly.
                    if (preset) addSource(createSource({ ...preset, enabled: true }));
                  }}
                >
                  <option value="" disabled>从预制添加…</option>
                  {availablePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
              )}
              <button className="tl-btn" disabled={full} onClick={() => addSource(createSource({ id: createId("source"), name: "自定义市场源", url: "https://" }))}><Plus size={14} /> 自定义</button>
            </div></div>
            {draft.sources.map((source) => (
              <div className="source-editor-row" key={source.id}>
                <button className={`source-toggle ${source.enabled ? "enabled" : ""}`} aria-pressed={source.enabled} onClick={() => updateSource(source.id, { enabled: !source.enabled })} aria-label={source.enabled ? "停用数据源" : "启用数据源"} title={source.enabled ? "停用数据源" : "启用数据源"}><span /></button>
                <div><input aria-label="数据源名称" maxLength={120} value={source.name} onChange={(event) => updateSource(source.id, { name: event.target.value })} /><input aria-label={`${source.name} URL`} maxLength={2048} className="url-input" value={source.url} onChange={(event) => updateSource(source.id, { url: event.target.value })} /></div>
                <button className="icon-button small" aria-label={`删除数据源 ${source.name}`} onClick={() => onChange({ ...draft, sources: draft.sources.filter((item) => item.id !== source.id) })} title={`删除数据源 ${source.name}`}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <div className="settings-note"><ShieldCheck size={15} /><span>模型只接收标题、摘要、发布时间和链接；只有来源中明确给出时间的事件才会自动进入时间线。连续失败的数据源会暂停抓取，保存设置后立即恢复。</span></div>
        </div>
        <div className="panel-footer"><button className="tl-btn" onClick={onClose}>取消</button><button className="tl-btn primary" disabled={busy} onClick={onSave}>{busy ? <LoaderCircle className="spin" size={15} /> : <SlidersHorizontal size={14} />}保存并重新扫描</button></div>
      </div>
    </div>
  );
}

const encodeModel = (selection: ModelSelection | null) => (selection ? JSON.stringify([selection.authConfigId, selection.model]) : "");

/** Picks one of the providers' models configured in Daily; empty follows the Daily default. */
function ModelSelect({ models, value, onChange }: { models: ModelListResponse | null; value: ModelSelection | null; onChange: (value: ModelSelection | null) => void }) {
  const providerName = (id: string | undefined) => models?.providers.find((provider) => provider.id === id)?.name ?? id ?? "";
  const listed = Boolean(value && models?.providers.some((provider) => provider.id === value.authConfigId && value.model && provider.models.includes(value.model)));
  return (
    <select
      value={encodeModel(value)}
      onChange={(event) => {
        if (!event.target.value) return onChange(null);
        const [authConfigId, model] = JSON.parse(event.target.value) as [string, string];
        onChange({ authConfigId, model });
      }}
    >
      <option value="">{models ? `Daily 默认（${providerName(models.default.authConfigId)} · ${models.default.model}）` : "Daily 默认"}</option>
      {value && !listed ? <option value={encodeModel(value)}>{providerName(value.authConfigId)} · {value.model}{models ? "（已不可用）" : ""}</option> : null}
      {models?.providers.map((provider) => (
        <optgroup key={provider.id} label={provider.name}>
          {provider.models.map((model) => <option key={model} value={encodeModel({ authConfigId: provider.id, model })}>{model}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
