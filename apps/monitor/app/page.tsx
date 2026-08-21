import path from "node:path";
import { JsonlStore } from "@cigam-waydata/file-logger";
import { Dashboard } from "./dashboard";

export const dynamic = "force-dynamic";

function dateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ ?? "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export default async function Home() {
  const store = new JsonlStore(path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIRECTORY ?? "../../data"));
  const today = dateKey(new Date());
  const events = await store.readLogs(today, today);
  const health = await store.readHealth();
  return <Dashboard initialEvents={events} initialHealth={health} today={today} />;
}
