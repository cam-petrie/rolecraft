import React from "react";
import { TrendingUp } from "lucide-react";
export default function FitImpact({ impact, stale = false }) {
  if (!impact) return <p className="impact-missing">Reanalyze or request a new suggestion to estimate its fit-score impact.</p>;
  const range = impact.minPoints === impact.maxPoints ? impact.minPoints : `${impact.minPoints}–${impact.maxPoints}`;
  return <div className={`fit-impact ${stale ? "outdated" : ""}`}>
    <span><TrendingUp size={14} /><strong>+{range} fit points</strong><small>{stale ? "Original estimate" : "Estimated impact"}</small></span>
    <p>{impact.rationale}</p>
    <small>Estimate for this edit alone. Not additive or guaranteed.{stale && " Resume or role has changed; request a fresh estimate."}</small>
  </div>;
}
