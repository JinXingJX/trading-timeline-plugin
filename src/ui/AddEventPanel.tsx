import { AlertTriangle, Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { createManualEvent } from "../domain/manualEvent";
import { localInputValueInTimeZone } from "../domain/time";
import { errorMessage } from "../host";
import type { ImpactLevel, MarketEvent } from "../types";
import { useDialogFocus } from "./useDialogFocus";

export function AddEventPanel({ timezone, onClose, onAdd }: { timezone: string; onClose: () => void; onAdd: (event: MarketEvent) => void }) {
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState(localInputValueInTimeZone(Date.now() + 60 * 60_000, timezone));
  const [impact, setImpact] = useState<ImpactLevel>("high");
  const [category, setCategory] = useState("宏观");
  const [symbols, setSymbols] = useState("");
  const [thesis, setThesis] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const panelRef = useDialogFocus<HTMLFormElement>(onClose);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setFormError("请输入事件标题。");
      return;
    }
    try {
      onAdd(createManualEvent({ title, scheduledAt, impact, category, symbols: symbols.split(/[,，]/), thesis, timezone }));
    } catch (error) {
      setFormError(errorMessage(error, "计划时间无效。"));
    }
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="add-event-title">
      <form ref={panelRef} className="panel add-panel" onSubmit={submit}>
        <div className="panel-header"><div><h2 id="add-event-title">添加观察事件</h2><span>到点后会按设置自动分析</span></div><button className="icon-button" type="button" aria-label="关闭添加事件" onClick={onClose}><X size={18} /></button></div>
        <div className="panel-body">
          {formError ? <div className="tl-notice error inline" role="alert"><AlertTriangle size={15} /><span>{formError}</span></div> : null}
          <label className="field full"><span>事件标题</span><input autoFocus maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例：FOMC 利率决议" /></label>
          <div className="field-grid">
            <label className="field"><span>计划时间</span><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
            <label className="field"><span>影响级别</span><select value={impact} onChange={(event) => setImpact(event.target.value as ImpactLevel)}><option value="high">高影响</option><option value="medium">中影响</option><option value="low">低影响</option></select></label>
            <label className="field"><span>类别</span><input maxLength={40} value={category} onChange={(event) => setCategory(event.target.value)} /></label>
            <label className="field"><span>相关资产</span><input maxLength={300} value={symbols} onChange={(event) => setSymbols(event.target.value)} placeholder="SPY, DXY, 黄金" /></label>
          </div>
          <label className="field full"><span>事前假设</span><textarea maxLength={600} value={thesis} onChange={(event) => setThesis(event.target.value)} placeholder="到点后最需要验证什么？" /></label>
        </div>
        <div className="panel-footer"><button className="tl-btn" type="button" onClick={onClose}>取消</button><button className="tl-btn primary" type="submit"><Plus size={14} />加入时间线</button></div>
      </form>
    </div>
  );
}
