import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { Colors } from '../theme';
import type { DayValue } from '../domain/types';
import { shortDayLabel, weekdayLetter } from '../domain/time';

interface Props {
  data: DayValue[];
  color: string;
  kind?: 'bar' | 'line';
  height?: number;
  goal?: number | null;
  overlay?: DayValue[]; // e.g. moving average, drawn as a thin line
  formatValue?: (v: number) => string;
  /** Custom x-axis label per point; return null to hide. Defaults to weekday letters / dates. */
  xLabel?: (d: DayValue, index: number) => string | null;
}

/** Lightweight SVG bar/line chart for daily series. Gaps (NaN) break the line. */
export function TrendChart({ data, color, kind = 'bar', height = 160, goal, overlay, formatValue, xLabel }: Props) {
  const [width, setWidth] = useState(0);
  const padTop = 18;
  const padBottom = 22;
  const padX = 6;
  const plotH = height - padTop - padBottom;
  const n = data.length;

  const finite = data.map(d => d.value).filter(Number.isFinite);
  const overlayFinite = (overlay ?? []).map(d => d.value).filter(Number.isFinite);
  let max = Math.max(1, ...finite, ...overlayFinite, goal ?? 0);
  let min = kind === 'line' ? Math.min(...finite, ...overlayFinite, goal ?? Infinity) : 0;
  if (!Number.isFinite(min)) min = 0;
  if (kind === 'line' && finite.length) {
    const span = Math.max(1, max - min);
    max += span * 0.1;
    min = Math.max(0, min - span * 0.1);
  }
  const range = Math.max(1e-6, max - min);
  const yFor = (v: number) => padTop + plotH - ((v - min) / range) * plotH;
  const slot = n ? (width - padX * 2) / n : 0;
  const xFor = (i: number) => padX + slot * i + slot / 2;

  const pathFor = (series: DayValue[]) => {
    let d = '';
    let open = false;
    series.forEach((p, i) => {
      if (!Number.isFinite(p.value)) {
        open = false;
        return;
      }
      d += `${open ? 'L' : 'M'}${xFor(i).toFixed(1)},${yFor(p.value).toFixed(1)} `;
      open = true;
    });
    return d;
  };

  const labelEvery = n <= 7 ? 1 : n <= 31 ? 5 : 15;
  const defaultLabel = (d: DayValue, i: number): string | null => {
    if (n <= 7) return weekdayLetter(d.day);
    return i % labelEvery === 0 ? shortDayLabel(d.day) : null;
  };
  const labelFor = xLabel ?? defaultLabel;
  const lastFinite = [...data].reverse().find(d => Number.isFinite(d.value));
  const lastIndex = lastFinite ? data.lastIndexOf(lastFinite) : -1;

  return (
    <View style={[styles.wrap, { height }]} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && n > 0 ? (
        <Svg width={width} height={height}>
          {goal != null && goal > 0 ? (
            <Line
              x1={padX}
              x2={width - padX}
              y1={yFor(goal)}
              y2={yFor(goal)}
              stroke={Colors.textDim}
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          ) : null}
          {kind === 'bar'
            ? data.map((d, i) => {
                const v = Number.isFinite(d.value) ? d.value : 0;
                const barW = Math.max(2, slot * 0.6);
                const y = yFor(v);
                const h = Math.max(v > 0 ? 2 : 0, padTop + plotH - y);
                const met = goal != null && goal > 0 && v >= goal;
                return (
                  <Rect
                    key={d.day}
                    x={xFor(i) - barW / 2}
                    y={y}
                    width={barW}
                    height={h}
                    rx={Math.min(4, barW / 2)}
                    fill={met ? color : `${color}99`}
                  />
                );
              })
            : null}
          {kind === 'line' ? <Path d={pathFor(data)} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" /> : null}
          {kind === 'line'
            ? data.map((d, i) => {
                // A reading with a gap on both sides has no line segment to sit on, so it needs its own dot.
                const isolated =
                  Number.isFinite(d.value) && !Number.isFinite(data[i - 1]?.value) && !Number.isFinite(data[i + 1]?.value);
                return isolated && i !== lastIndex ? (
                  <Circle key={`p${d.day}`} cx={xFor(i)} cy={yFor(d.value)} r={3} fill={color} />
                ) : null;
              })
            : null}
          {overlay ? <Path d={pathFor(overlay)} stroke={Colors.textSecondary} strokeWidth={1.5} fill="none" /> : null}
          {kind === 'line' && lastIndex >= 0 && lastFinite ? (
            <Circle cx={xFor(lastIndex)} cy={yFor(lastFinite.value)} r={4} fill={color} />
          ) : null}
          {lastIndex >= 0 && lastFinite && formatValue ? (
            <SvgText
              x={Math.min(width - padX - 24, Math.max(padX + 24, xFor(lastIndex)))}
              y={Math.max(10, yFor(lastFinite.value) - 8)}
              fill={Colors.text}
              fontSize={11}
              fontWeight="600"
              textAnchor="middle">
              {formatValue(lastFinite.value)}
            </SvgText>
          ) : null}
          {data.map((d, i) => {
            const label = labelFor(d, i);
            return label ? (
              <SvgText key={`l${d.day}`} x={xFor(i)} y={height - 6} fill={Colors.textDim} fontSize={10} textAnchor="middle">
                {label}
              </SvgText>
            ) : null;
          })}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
});
