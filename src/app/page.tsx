import { CONFIG } from "@/lib/config";
import Dashboard from "./components/Dashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main>
      <Dashboard />
      <noscript>
        <div style={{ padding: 24, color: "#f87171" }}>
          UGC Snap needs JavaScript to stream fresh deals.
        </div>
      </noscript>
      <pre className="hidden" data-config={JSON.stringify({ notifications: CONFIG.NOTIFICATIONS_ENABLED })} />
    </main>
  );
}
