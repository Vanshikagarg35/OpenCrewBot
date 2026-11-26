// sales spreadsheet analysis. this is real calculation (works in mock mode also)
// i didnt use any csv library, simple split is enough for our sample file
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STAGE_ORDER = ["lead", "contacted", "counselling_done", "application_started", "converted"];

function parseCsv(text: string) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const obj: any = {};
    header.forEach((h, idx) => (obj[h] = (cols[idx] || "").trim()));
    rows.push(obj);
  }
  return rows;
}

function pct(a: number, b: number) {
  if (b == 0) return "0%";
  return ((a / b) * 100).toFixed(1) + "%";
}

function bar(value: number, max: number) {
  const n = max == 0 ? 0 : Math.round((value / max) * 20);
  return "█".repeat(n) + "░".repeat(20 - n);
}

function groupBy(rows: any[], key: string) {
  const g: any = {};
  for (const r of rows) {
    const k = r[key] || "(blank)";
    if (!g[k]) g[k] = { leads: 0, converted: 0, lost: 0, revenue: 0 };
    g[k].leads++;
    if (r.stage == "converted") {
      g[k].converted++;
      g[k].revenue += Number(r.deal_value_inr || 0);
    }
    if (r.stage == "lost") g[k].lost++;
  }
  return g;
}

function table(title: string, g: any) {
  let s = `\n#### ${title}\n\n| ${title} | Leads | Converted | Conv. rate | Revenue (INR) | Chart |\n|---|---|---|---|---|---|\n`;
  const keys = Object.keys(g).sort((a, b) => g[b].revenue - g[a].revenue);
  const maxRev = Math.max(...keys.map((k) => g[k].revenue));
  for (const k of keys) {
    const x = g[k];
    s += `| ${k} | ${x.leads} | ${x.converted} | ${pct(x.converted, x.leads)} | ${x.revenue.toLocaleString("en-IN")} | \`${bar(x.revenue, maxRev)}\` |\n`;
  }
  return s;
}

export function analyzeSalesCsv(filePath?: string): string {
  const p = resolve(filePath || "./samples/sales_sample.csv");
  const rows = parseCsv(readFileSync(p, "utf8"));
  const total = rows.length;
  const converted = rows.filter((r) => r.stage == "converted").length;
  const lost = rows.filter((r) => r.stage == "lost").length;
  const revenue = rows.reduce((sum, r) => sum + (r.stage == "converted" ? Number(r.deal_value_inr || 0) : 0), 0);

  let out = `Source file: ${p}\nRows analysed: ${total}\n\n`;
  out += `**Overall:** ${converted} converted out of ${total} leads = ${pct(converted, total)} conversion. ${lost} lost (${pct(lost, total)}). Total revenue INR ${revenue.toLocaleString("en-IN")}.\n`;

  // funnel - how many reached at least stage X (lost ones are not counted in any later stage, limitation)
  out += `\n#### Funnel (reached at least this stage)\n\n| Stage | Count | % of leads | Drop from prev |\n|---|---|---|---|\n`;
  let prev = -1;
  let worstDrop = { stage: "", drop: 0 };
  for (let i = 0; i < STAGE_ORDER.length; i++) {
    const reached = rows.filter((r) => STAGE_ORDER.indexOf(r.stage) >= i).length;
    const drop = prev == -1 ? 0 : prev - reached;
    const dropPct = prev <= 0 ? 0 : (drop / prev) * 100;
    if (dropPct > worstDrop.drop) worstDrop = { stage: STAGE_ORDER[i - 1] + " → " + STAGE_ORDER[i], drop: dropPct };
    out += `| ${STAGE_ORDER[i]} | ${reached} | ${pct(reached, total)} | ${prev == -1 ? "-" : dropPct.toFixed(1) + "%"} |\n`;
    prev = reached;
  }
  out += `\n**Biggest bottleneck:** ${worstDrop.stage} (${worstDrop.drop.toFixed(1)}% drop)\n`;

  out += table("product_line", groupBy(rows, "product_line"));
  out += table("segment", groupBy(rows, "segment"));
  out += table("channel", groupBy(rows, "channel"));

  // counsellor blank = data quality issue
  const blank = rows.filter((r) => !r.counsellor).length;
  out += `\nData quality: ${blank} rows have no counsellor assigned (${pct(blank, total)}).\n`;
  return out;
}
