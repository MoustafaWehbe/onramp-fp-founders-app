import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDuration } from "../../lib/utils";

/** Page number → active time, one horizontal bar per page. */
export function PerPageTimeChart({
  pages,
}: {
  pages: Array<{ pageNumber: number; activeMs: number }>;
}) {
  const data = pages.map((p) => ({ page: `P${p.pageNumber}`, seconds: Math.round(p.activeMs / 1000) }));
  // Horizontal bars grow with page count rather than squeezing into a fixed
  // box — a 40-page deck needs more vertical room than a 4-page one-pager.
  const height = Math.min(480, Math.max(120, data.length * 28));

  return (
    <div style={{ height }} aria-label="Time spent per page">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#30363D" horizontal={false} />
          <XAxis
            type="number"
            stroke="#8B949E"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatDuration(Number(value) * 1000)}
          />
          <YAxis
            type="category"
            dataKey="page"
            width={36}
            stroke="#8B949E"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            formatter={(value) => [formatDuration(Number(value) * 1000), "Active time"]}
            contentStyle={{ background: "#1C2128", border: "1px solid #30363D", borderRadius: 10, fontSize: 12 }}
            labelStyle={{ color: "#8B949E" }}
          />
          <Bar dataKey="seconds" fill="#F97316" radius={[0, 4, 4, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
