"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function MetricChart({
  data,
}: {
  data: Array<{ step: number; loss?: number; acc?: number }>;
}) {
  return (
    <div className="console-panel">
      <div className="console-panel-header">
        <div>
          <div className="console-panel-title">训练指标</div>
          <div className="console-panel-description">Loss 与准确率曲线按 step 聚合展示。</div>
        </div>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <LineChart data={data}>
            <XAxis dataKey="step" stroke="#6f7f95" />
            <YAxis stroke="#6f7f95" />
            <Tooltip />
            <Line type="monotone" dataKey="loss" stroke="#f6a609" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="acc" stroke="#16c59e" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
