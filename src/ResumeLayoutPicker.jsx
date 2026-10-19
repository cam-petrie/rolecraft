import React, { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { resumeLayouts, selectedResumeLayout } from "./resume-layouts.js";
function MiniResume({ layout }) {
  return <svg viewBox="0 0 150 160" className={`layout-mini layout-mini-${layout.id}`} aria-hidden="true">
    <rect x="22" y="5" width="106" height="148" rx="2" fill="white" stroke="#d9dfd8" />
    {layout.id === "original" && <rect x="28" y="11" width="94" height="136" rx="1" fill="none" stroke="#a0aea0" strokeDasharray="3 3" />}
    <rect x={layout.centered ? 48 : 34} y="20" width="59" height="5" rx="1" fill={`#${layout.accent}`} />
    <rect x={layout.centered ? 53 : 34} y="30" width="46" height="2" rx="1" fill="#a9b3af" />
    {[44, 78, 112].map((y) => <g key={y}>
      {layout.shaded && <rect x="32" y={y - 3} width="85" height="10" fill="#edf2f7" />}
      <rect x="34" y={y} width="33" height="3" rx=".7" fill={`#${layout.accent}`} />
      {!layout.minimal && !layout.shaded && <path d={`M34 ${y+7}h81`} stroke={`#${layout.accent}`} strokeWidth=".6" />}
      {[0,1,2].map((row) => <g key={row}>
        {y > 44 && <circle cx="35" cy={y+14+row*(layout.compact ? 4 : 5)} r=".8" fill="#81908b" />}
        <rect x={y > 44 ? 39 : 34} y={y+13+row*(layout.compact ? 4 : 5)} width={row === 2 ? 55 : 76} height="1.5" rx=".5" fill="#b3bdb8" />
      </g>)}
    </g>)}
  </svg>;
}
export default function ResumeLayoutPicker({ current, onChoose, onClose }) {
  const ref = useRef();
  const [choice, setChoice] = useState(selectedResumeLayout(current).id);
  useEffect(() => {
    const el = ref.current, previous = document.activeElement;
    el.showModal();
    return () => { el.close(); previous?.focus?.(); };
  }, []);
  return <dialog ref={ref} className="resume-layout-dialog" aria-labelledby="layout-picker-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <div className="modal-top"><h2 id="layout-picker-title">Choose your resume layout</h2><button className="icon-btn" aria-label="Close layout picker" onClick={onClose}><X size={20}/></button></div>
    <div className="modal-body">
      <p className="layout-picker-intro">Keep the look you brought, or try a fresh format. You can change this anytime in Refine.</p>
      <div className="resume-layout-grid" role="radiogroup" aria-label="Resume layout">
        {resumeLayouts.map((layout, index) => <button key={layout.id} type="button" role="radio" aria-checked={choice === layout.id} tabIndex={choice === layout.id ? 0 : -1} onKeyDown={(e) => {
          const direction = { ArrowRight: 1, ArrowDown: 3, ArrowLeft: -1, ArrowUp: -3 }[e.key];
          if (direction) { e.preventDefault(); const next = (index + direction + 6) % 6; setChoice(resumeLayouts[next].id); e.currentTarget.parentElement.querySelectorAll('[role="radio"]')[next].focus(); }
        }} className={`resume-layout-card ${choice === layout.id ? "selected" : ""}`} onClick={() => setChoice(layout.id)}>
          <span className="layout-check">{choice === layout.id && <Check size={14}/>}</span>
          <MiniResume layout={layout}/><strong>{layout.name}</strong><span>{layout.description}</span>
        </button>)}
      </div>
      <p className="small muted">New layouts rebuild the resume’s text and may change pagination. Your original file and edits are kept.</p>
      <div className="layout-picker-actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onChoose(choice)}>{choice === "original" ? "Keep default formatting" : `Use ${selectedResumeLayout(choice).name}`}</button></div>
    </div>
  </dialog>;
}
