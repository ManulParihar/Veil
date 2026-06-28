'use client';

import React, { useState, useMemo, useEffect, useRef, useId } from 'react';
import { motion } from 'framer-motion';
import CountUp from 'react-countup';
import {
  StackedAreaChart,
  StackedAreaSeries,
  LinearXAxis,
  LinearXAxisTickSeries,
  LinearXAxisTickLabel,
  LinearYAxis,
  LinearYAxisTickSeries,
  LinearYAxisTickLabel,
  Line,
  Area,
  Gradient,
  GradientStop,
  GridlineSeries,
  Gridline,
  TooltipArea,
} from 'reaviz';
import { useWallet } from '../../store/wallet';
import { formatAmount } from '../../lib/currencies';
import type { TxRecord } from '../../lib/types';

// --- Poof Themed Types ---
interface ChartDataPoint {
  key: Date;
  data: number;
}

interface ChartSeries {
  key: string;
  data: ChartDataPoint[];
}

interface LegendItem {
  name: string;
  color: string;
}

interface TimePeriodOption {
  value: string;
  label: string;
}

interface ActivityStat {
  id: string;
  title: string;
  count: number;
  countFrom?: number;
  comparisonText: string;
  percentage: number;
  TrendIconSvg: React.FC<{ strokeColor: string }>;
  trendColor: string;
  trendBgColor: string;
}

interface DetailedMetric {
  id: string;
  Icon: React.FC<{ className?: string; fill?: string }>;
  label: string;
  tooltip: string;
  value: string;
  TrendIcon: React.FC<{ baseColor: string; strokeColor: string; className?: string }>;
  trendBaseColor: string;
  trendStrokeColor: string;
  delay: number;
  iconFillColor?: string;
}

// --- Poof Themed Icons (Gold + Lavender) ---
const ShieldIcon: React.FC<{ className?: string; fill?: string }> = ({ className, fill = "#E8D5A3" }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M10 2L3 5V10C3 14.4183 6.58172 18 11 18C15.4183 18 19 14.4183 19 10V5L10 2Z" stroke={fill} strokeWidth="1.5" fill="rgba(232,213,163,0.1)"/>
    <path d="M7 10L9 12L13 8" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const NoteIcon: React.FC<{ className?: string; fill?: string }> = ({ className, fill = "#E8D5A3" }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M5 3H15C16.1046 3 17 3.89543 17 5V15C17 16.1046 16.1046 17 15 17H5C3.89543 17 3 16.1046 3 15V5C3 3.89543 3.89543 3 5 3Z" stroke={fill} strokeWidth="1.5"/>
    <path d="M6 7H14M6 11H10" stroke="#A78BFA" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const FlowIcon: React.FC<{ className?: string; fill?: string }> = ({ className, fill = "#E8D5A3" }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M3 10H17M17 10L13 6M17 10L13 14" stroke={fill} strokeWidth="2" strokeLinecap="round"/>
    <path d="M17 10H3" stroke="#A78BFA" strokeWidth="1.5" strokeDasharray="2 2"/>
  </svg>
);

// Trend icons (reusing from previous Poof theme)
const TrendUp: React.FC<{ strokeColor: string }> = ({ strokeColor }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="21" viewBox="0 0 20 21" fill="none">
    <path d="M5.50134 9.11119L10.0013 4.66675M10.0013 4.66675L14.5013 9.11119M10.0013 4.66675L10.0013 16.3334" stroke={strokeColor} strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const TrendDown: React.FC<{ strokeColor: string }> = ({ strokeColor }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="21" viewBox="0 0 20 21" fill="none">
    <path d="M14.4987 11.8888L9.99866 16.3333M9.99866 16.3333L5.49866 11.8888M9.99866 16.3333V4.66658" stroke={strokeColor} strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const DetailedTrendUpIcon: React.FC<{ baseColor: string; strokeColor: string; className?: string }> = ({ baseColor, strokeColor, className }) => (
  <svg className={className} width="28" height="28" viewBox="0 0 28 28" fill="none">
    <rect width="28" height="28" rx="14" fill={baseColor} fillOpacity="0.4" />
    <path d="M9.50134 12.6111L14.0013 8.16663M14.0013 8.16663L18.5013 12.6111M14.0013 8.16663L14.0013 19.8333" stroke={strokeColor} strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const DetailedTrendDownIcon: React.FC<{ baseColor: string; strokeColor: string; className?: string }> = ({ baseColor, strokeColor, className }) => (
  <svg className={className} width="28" height="28" viewBox="0 0 28 28" fill="none">
    <rect width="28" height="28" rx="14" fill={baseColor} fillOpacity="0.4" />
    <path d="M18.4987 15.3889L13.9987 19.8334M13.9987 19.8334L9.49866 15.3889M13.9987 19.8334V8.16671" stroke={strokeColor} strokeWidth="2" strokeLinecap="square" />
  </svg>
);

// --- Data ---
const LEGEND_ITEMS: LegendItem[] = [
  { name: 'Deposits', color: '#E8D5A3' },
  { name: 'Sends', color: '#A78BFA' },
  { name: 'Withdraws', color: '#E85A9E' },
];

const CHART_COLOR_SCHEME = ['#E8D5A3', '#A78BFA', '#E85A9E'];

const TIME_PERIOD_OPTIONS: TimePeriodOption[] = [
  { value: 'last-7-days', label: 'Last 7 Days' },
  { value: 'last-30-days', label: 'Last 30 Days' },
];

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Which chart series a tx kind contributes to (or null = ignored). */
const KIND_TO_SERIES: Record<string, 'Deposits' | 'Sends' | 'Withdraws' | null> = {
  deposit: 'Deposits',
  transfer: 'Sends',
  withdraw: 'Withdraws',
  receive: null,
  faucet: null,
  fund: null,
};

/**
 * Build the stacked-area series from the wallet's real tx history, bucketed by
 * day across the selected window. If there's no real activity yet we fall back
 * to a small synthetic sample so the chart never renders empty.
 */
const buildChartData = (txs: TxRecord[], days: number): { data: ChartSeries[]; isSample: boolean } => {
  const today = startOfDay(new Date());
  const buckets: Record<'Deposits' | 'Sends' | 'Withdraws', number[]> = {
    Deposits: new Array(days).fill(0),
    Sends: new Array(days).fill(0),
    Withdraws: new Array(days).fill(0),
  };

  let counted = 0;
  for (const tx of txs) {
    const series = KIND_TO_SERIES[tx.kind];
    if (!series) continue;
    const day = startOfDay(new Date(tx.createdAt));
    const idx = days - 1 - Math.round((today.getTime() - day.getTime()) / DAY_MS);
    if (idx < 0 || idx >= days) continue;
    buckets[series][idx] += 1;
    counted += 1;
  }

  const dateFor = (i: number) => new Date(today.getTime() - (days - 1 - i) * DAY_MS);

  if (counted === 0) {
    // gentle synthetic sample (clearly a demo, but keeps the chart alive)
    const sample = (base: number, jit: number) =>
      Array.from({ length: days }, (_, i) => ({ key: dateFor(i), data: Math.floor(Math.random() * jit) + base }));
    return {
      isSample: true,
      data: [
        { key: 'Deposits', data: sample(6, 10) },
        { key: 'Sends', data: sample(4, 9) },
        { key: 'Withdraws', data: sample(2, 6) },
      ],
    };
  }

  return {
    isSample: false,
    data: (['Deposits', 'Sends', 'Withdraws'] as const).map((key) => ({
      key,
      data: buckets[key].map((data, i) => ({ key: dateFor(i), data })),
    })),
  };
};

const meanGapDays = (txs: TxRecord[]): number | null => {
  if (txs.length < 2) return null;
  const ts = txs.map((t) => t.createdAt).sort((a, b) => a - b);
  let sum = 0;
  for (let i = 1; i < ts.length; i++) sum += ts[i] - ts[i - 1];
  return sum / (ts.length - 1) / DAY_MS;
};

const ACTIVITY_STATS: ActivityStat[] = [
  {
    id: 'transfers',
    title: 'Private Transfers',
    count: 47,
    countFrom: 0,
    comparisonText: 'Compared to 39 last period',
    percentage: 18,
    TrendIconSvg: TrendUp,
    trendColor: 'text-[#E8D5A3]',
    trendBgColor: 'bg-[#E8D5A3]/20',
  },
  {
    id: 'notes',
    title: 'Notes Created',
    count: 128,
    countFrom: 0,
    comparisonText: 'Compared to 114 last period',
    percentage: 9,
    TrendIconSvg: TrendUp,
    trendColor: 'text-[#A78BFA]',
    trendBgColor: 'bg-[#A78BFA]/20',
  },
];

/** Gold-on-ink time-window picker, styled to match the Asset dropdown
 *  (CurrencySelect) used in the Send flow. A custom listbox instead of a
 *  native <select> so the open menu carries the app's aesthetic. */
const TimePeriodSelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = TIME_PERIOD_OPTIONS.find(o => o.value === value) ?? TIME_PERIOD_OPTIONS[0];

  // Close on outside click or Escape so the menu behaves like a real dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Select time period"
        className={`group flex items-center gap-2 rounded-xl border bg-poof-surface px-3 py-2
                    text-left text-sm transition outline-none
                    ${open
                      ? 'border-poof-gold ring-2 ring-poof-gold/30'
                      : 'border-poof-border hover:border-poof-gold/50'}`}
      >
        <span className="font-medium text-poof-text whitespace-nowrap">{selected.label}</span>
        <svg
          className={`h-4 w-4 text-poof-muted transition-transform duration-200 ${open ? 'rotate-180 text-poof-gold' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Select time period"
          className="absolute right-0 z-20 mt-2 w-full min-w-max overflow-hidden rounded-xl border border-poof-border
                     bg-poof-card/95 p-1.5 shadow-glow backdrop-blur-xl animate-fade-in"
        >
          {TIME_PERIOD_OPTIONS.map(option => {
            const active = option.value === value;
            return (
              <li key={option.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => pick(option.value)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition
                              ${active ? 'bg-poof-gold/10' : 'hover:bg-poof-surface'}`}
                >
                  <span className={`flex-1 whitespace-nowrap font-medium ${active ? 'text-poof-gold' : 'text-poof-text'}`}>
                    {option.label}
                  </span>
                  {active && (
                    <svg
                      className="h-4 w-4 text-poof-gold"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const AdvancedPoofActivityReport: React.FC = () => {
  const [selectedTimePeriod, setSelectedTimePeriod] = useState<string>(TIME_PERIOD_OPTIONS[0].value);
  const wallet = useWallet();

  const days = selectedTimePeriod === 'last-30-days' ? 30 : 7;
  const { data: chartData, isSample } = useMemo(
    () => buildChartData(wallet.txs, days),
    [wallet.txs, days]
  );

  // Derived, real stats from the wallet
  const realNoteCount = wallet.notes.filter(n => !n.spent && !n.invalidReason).length;
  const realTxCount = wallet.txs.length;
  // self-sends/decoys are recorded as "self"; count them alongside transfers
  const transferCount = wallet.txs.filter(t => t.kind === 'transfer' || t.kind === 'self').length;

  // Real detailed metrics (with graceful fallbacks)
  const detailedMetrics = useMemo<DetailedMetric[]>(() => {
    const transfers = wallet.txs.filter(t => (t.kind === 'transfer' || t.kind === 'self') && t.amount > 0n);
    const avgTransfer = transfers.length
      ? formatAmount(transfers.reduce((s, t) => s + t.amount, 0n) / BigInt(transfers.length), 0)
      : '—';
    const gap = meanGapDays(wallet.txs);
    const settled = wallet.txs.filter(t => t.status === 'success').length;
    const mix = wallet.txs.length ? Math.round((settled / wallet.txs.length) * 100) : 0;
    return [
      { id: 'avgsize', Icon: ShieldIcon, label: 'Avg Private Transfer', tooltip: 'Average value moved privately',
        value: avgTransfer, TrendIcon: DetailedTrendUpIcon, trendBaseColor: '#E8D5A3', trendStrokeColor: '#D4B36E', delay: 0, iconFillColor: '#E8D5A3' },
      { id: 'interval', Icon: NoteIcon, label: 'Mean Time Between Actions', tooltip: 'Average time between your private moves',
        value: gap == null ? '—' : `${gap.toFixed(1)} days`, TrendIcon: DetailedTrendDownIcon, trendBaseColor: '#A78BFA', trendStrokeColor: '#7B6BFF', delay: 0.05, iconFillColor: '#A78BFA' },
      { id: 'mix', Icon: FlowIcon, label: 'Settlement Success', tooltip: 'Share of your actions that settled on-chain',
        value: `${mix}%`, TrendIcon: DetailedTrendUpIcon, trendBaseColor: '#E8D5A3', trendStrokeColor: '#D4B36E', delay: 0.1, iconFillColor: '#E8D5A3' },
    ];
  }, [wallet.txs]);

  return (
      <div className="flex flex-col justify-between pt-4 pb-4 bg-poof-card rounded-3xl shadow-glow border border-poof-border w-full overflow-hidden">
        {/* Header - Poof Style */}
        <div className="flex justify-between items-center p-7 pt-6 pb-6">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-2xl font-semibold text-poof-text">Private Activity Report</h3>
              {isSample && (
                <span className="text-[10px] uppercase tracking-wide text-poof-gold/80 border border-poof-gold/30 bg-poof-gold/10 px-2 py-0.5 rounded-full">
                  sample
                </span>
              )}
            </div>
            <p className="text-poof-muted text-xs mt-0.5">Your shielded value flows — no one else sees the details.</p>
          </div>
          <TimePeriodSelect value={selectedTimePeriod} onChange={setSelectedTimePeriod} />
        </div>

        {/* Legend - Gold/Lavender */}
        <div className="flex gap-6 w-full pl-7 pr-7 mb-2">
          {LEGEND_ITEMS.map((item) => (
            <div key={item.name} className="flex gap-2 items-center">
              <div className="w-3.5 h-3.5 rounded-sm" style={{ backgroundColor: item.color }} />
              <span className="text-poof-muted text-xs">{item.name}</span>
            </div>
          ))}
        </div>

        {/* Chart — clean gradient stacked area */}
        <div className="reaviz-chart-container h-[260px] px-4">
          <StackedAreaChart
            height={260}
            id="poof-stacked-activity"
            data={chartData}
            gridlines={
              <GridlineSeries line={<Gridline direction="y" strokeColor="#2A254570" />} />
            }
            xAxis={
              <LinearXAxis
                type="time"
                tickSeries={
                  <LinearXAxisTickSeries
                    line={null}
                    label={
                      <LinearXAxisTickLabel
                        format={v => new Date(v).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                        fill="#8B7FA3"
                      />
                    }
                  />
                }
              />
            }
            yAxis={
              <LinearYAxis
                type="value"
                axisLine={null}
                tickSeries={<LinearYAxisTickSeries line={null} label={<LinearYAxisTickLabel fill="#8B7FA3" />} />}
              />
            }
            series={
              <StackedAreaSeries
                interpolation="smooth"
                colorScheme={CHART_COLOR_SCHEME}
                line={<Line strokeWidth={2} />}
                area={
                  <Area
                    gradient={
                      <Gradient
                        stops={[
                          <GradientStop key="0" offset="0%" stopOpacity={0.05} />,
                          <GradientStop key="1" offset="80%" stopOpacity={0.45} />,
                        ]}
                      />
                    }
                  />
                }
                tooltip={<TooltipArea />}
              />
            }
          />
        </div>

        {/* Summary Stats - Poof Gold/Lavender */}
        <div className="flex flex-col sm:flex-row w-full pl-7 pr-7 justify-between pb-1 pt-6 gap-4">
          {ACTIVITY_STATS.map((stat, index) => (
            <div key={stat.id} className="flex flex-col gap-1.5 w-full sm:w-1/2">
              <span className="text-base text-poof-text">{stat.title}</span>
              <div className="flex items-center gap-2">
                <CountUp
                  className="font-mono text-3xl font-semibold text-poof-text tabular-nums"
                  start={stat.countFrom || 0}
                  end={realTxCount > 0 ? (index === 0 ? transferCount : realNoteCount) : stat.count}
                  duration={2.2}
                />
                <div className={`flex items-center gap-1 ${stat.trendBgColor} p-1 pl-2 pr-2 rounded-full text-xs ${stat.trendColor}`}>
                  <stat.TrendIconSvg strokeColor={stat.trendColor.includes('E8D5A3') ? '#E8D5A3' : '#A78BFA'} />
                  {stat.percentage}%
                </div>
              </div>
              <span className="text-poof-muted text-xs">{stat.comparisonText}</span>
            </div>
          ))}
        </div>

        {/* Detailed Metrics - Animated + Poof Colors */}
        <div className="flex flex-col pl-7 pr-7 font-mono divide-y divide-poof-border mt-4 text-sm">
          {detailedMetrics.map((metric) => (
            <motion.div
              key={metric.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: metric.delay }}
              className="flex w-full py-3.5 items-center gap-3"
            >
              <div className="flex flex-row gap-2 items-center w-1/2 text-poof-muted">
                <metric.Icon fill={metric.iconFillColor} className="h-4 w-4" />
                <span className="truncate" title={metric.tooltip}>{metric.label}</span>
              </div>
              <div className="flex gap-2 w-1/2 justify-end items-center">
                <span className="font-semibold text-poof-text tabular-nums">{metric.value}</span>
                <metric.TrendIcon baseColor={metric.trendBaseColor} strokeColor={metric.trendStrokeColor} className="h-5 w-5" />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
  );
};

export default AdvancedPoofActivityReport;