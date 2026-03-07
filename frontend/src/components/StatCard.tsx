import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  loading?: boolean;
}

export default function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  loading = false,
}: StatCardProps) {
  return (
    <div className="card group">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-gray-400 mb-1">{title}</p>
          {loading ? (
            <div className="h-8 w-24 bg-brand-border/50 rounded animate-pulse" />
          ) : (
            <p className="text-2xl font-bold text-foreground">{value}</p>
          )}
          {subtitle && (
            <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
          )}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-primary/10 border border-brand-primary/20">
          <Icon className="h-5 w-5 text-brand-primary" />
        </div>
      </div>
      {trend && (
        <div className="mt-3 pt-3 border-t border-brand-border">
          <span
            className={`text-xs font-medium ${
              trend === "up"
                ? "text-green-400"
                : trend === "down"
                  ? "text-red-400"
                  : "text-gray-400"
            }`}
          >
            {trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}{" "}
            {trend === "neutral" ? "Stable" : trend === "up" ? "Increasing" : "Decreasing"}
          </span>
        </div>
      )}
    </div>
  );
}
