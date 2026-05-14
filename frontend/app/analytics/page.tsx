import type { Metadata } from "next";

import { InventoryAnalyticsDashboard } from "@/components/analytics/inventory-analytics-dashboard";

export const metadata: Metadata = {
  title: "Аналитика ревизий",
};

export default function AnalyticsPage() {
  return <InventoryAnalyticsDashboard />;
}
