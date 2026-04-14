import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { fontFamily, radius } from "@/shared/theme";
import { useReduceMotionEnabled } from "@/shared/useReduceMotionEnabled";

import type { DetectionGraphNode, DetectionReasoningGraph } from "../types";

type Point = { x: number; y: number };

const PADDING_X = 18;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 16;
const HEADER_HEIGHT = 30;
const DRAG_ACTIVATION_DISTANCE = 2;

const toneMap = {
  primary: {
    ink: "#2F70E6",
    border: "#CFE0FF",
    fill: "#FFFFFF",
    soft: "#EAF2FF",
    line: "rgba(75,141,248,0.42)",
  },
  danger: {
    ink: "#D96A4A",
    border: "#F6D5CA",
    fill: "#FFF7F3",
    soft: "#FFF0EA",
    line: "rgba(217,106,74,0.38)",
  },
  safe: {
    ink: "#2E9D7F",
    border: "#CCEEE2",
    fill: "#F4FFFB",
    soft: "#E9FAF4",
    line: "rgba(46,157,127,0.38)",
  },
  warning: {
    ink: "#B97A2A",
    border: "#F4DFC2",
    fill: "#FFF9F1",
    soft: "#FFF3E2",
    line: "rgba(227,138,87,0.4)",
  },
  neutral: {
    ink: "#5A759B",
    border: "#DDE8F6",
    fill: "#FFFFFF",
    soft: "#F1F6FD",
    line: "rgba(90,117,155,0.28)",
  },
} as const;

function getTone(tone?: string | null) {
  if (!tone) {
    return toneMap.primary;
  }
  return toneMap[tone as keyof typeof toneMap] ?? toneMap.primary;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function EdgeFlow({
  from,
  to,
  color,
  delay,
}: {
  from: Point;
  to: Point;
  color: string;
  delay: number;
}) {
  const reduceMotion = useReduceMotionEnabled();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 0.62;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.linear }),
      -1,
      false,
    );
  }, [progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    const raw = (progress.value + delay) % 1;
    return {
      opacity: reduceMotion ? 0.82 : 0.24 + (1 - Math.abs(raw - 0.5) * 2) * 0.76,
      transform: [
        { translateX: from.x + (to.x - from.x) * raw - 4 },
        { translateY: from.y + (to.y - from.y) * raw - 4 },
        { scale: reduceMotion ? 0.96 : 0.82 + raw * 0.16 },
      ],
    };
  });

  return <Animated.View style={[styles.edgePulse, { backgroundColor: color }, animatedStyle]} />;
}

function GraphNodeBubble({
  node,
  point,
  size,
  bounds,
  highlighted,
  offset,
  onOffsetChange,
}: {
  node: DetectionGraphNode;
  point: Point;
  size: number;
  bounds: { width: number; height: number; topInset: number };
  highlighted: boolean;
  offset: Point;
  onOffsetChange: (offset: Point) => void;
}) {
  const reduceMotion = useReduceMotionEnabled();
  const pulse = useSharedValue(0);
  const tone = getTone(node.tone);
  const dragStartRef = useRef(offset);

  useEffect(() => {
    dragStartRef.current = offset;
  }, [offset]);

  useEffect(() => {
    if (reduceMotion || !highlighted) {
      pulse.value = highlighted ? 0.55 : 0;
      return;
    }
    pulse.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.linear }),
      -1,
      false,
    );
  }, [highlighted, pulse, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: highlighted ? 1 + pulse.value * 0.035 : 1 }],
    shadowOpacity: highlighted ? 0.14 + pulse.value * 0.08 : 0.08,
  }));

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: (_evt, gestureState) =>
          Math.abs(gestureState.dx) > DRAG_ACTIVATION_DISTANCE || Math.abs(gestureState.dy) > DRAG_ACTIVATION_DISTANCE,
        onMoveShouldSetPanResponderCapture: (_evt, gestureState) =>
          Math.abs(gestureState.dx) > DRAG_ACTIVATION_DISTANCE || Math.abs(gestureState.dy) > DRAG_ACTIVATION_DISTANCE,
        onPanResponderGrant: () => {
          dragStartRef.current = offset;
        },
        onPanResponderMove: (_evt, gestureState) => {
          const minCenterX = PADDING_X + size / 2;
          const maxCenterX = bounds.width - PADDING_X - size / 2;
          const minCenterY = bounds.topInset + size / 2;
          const maxCenterY = bounds.height - PADDING_BOTTOM - size / 2;
          const nextCenterX = clamp(point.x + dragStartRef.current.x + gestureState.dx, minCenterX, maxCenterX);
          const nextCenterY = clamp(point.y + dragStartRef.current.y + gestureState.dy, minCenterY, maxCenterY);
          onOffsetChange({ x: nextCenterX - point.x, y: nextCenterY - point.y });
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_evt, gestureState) => {
          const minCenterX = PADDING_X + size / 2;
          const maxCenterX = bounds.width - PADDING_X - size / 2;
          const minCenterY = bounds.topInset + size / 2;
          const maxCenterY = bounds.height - PADDING_BOTTOM - size / 2;
          const nextCenterX = clamp(point.x + dragStartRef.current.x + gestureState.dx, minCenterX, maxCenterX);
          const nextCenterY = clamp(point.y + dragStartRef.current.y + gestureState.dy, minCenterY, maxCenterY);
          onOffsetChange({ x: nextCenterX - point.x, y: nextCenterY - point.y });
        },
        onShouldBlockNativeResponder: () => true,
      }),
    [bounds.height, bounds.topInset, bounds.width, offset, onOffsetChange, point.x, point.y, size],
  );

  return (
    <Animated.View
      style={[
        styles.node,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          left: point.x + offset.x - size / 2,
          top: point.y + offset.y - size / 2,
          backgroundColor: tone.fill,
          borderColor: tone.border,
          shadowColor: tone.ink,
        },
        animatedStyle,
      ]}
      {...panResponder.panHandlers}
    >
      <View style={[styles.nodeHalo, { backgroundColor: tone.soft, opacity: highlighted ? 1 : 0.68 }]} />
      <Text style={[styles.nodeText, { color: tone.ink }]} numberOfLines={2}>
        {node.label}
      </Text>
    </Animated.View>
  );
}

export function GraphCanvas({
  graph,
  height = 260,
}: {
  graph: DetectionReasoningGraph;
  height?: number;
}) {
  const [width, setWidth] = useState(320);
  const [dragOffsets, setDragOffsets] = useState<Record<string, Point>>({});

  const laneLabels = useMemo(
    () =>
      Array.isArray(graph.lane_labels)
        ? graph.lane_labels.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        : [],
    [graph.lane_labels],
  );

  const graphSignature = useMemo(() => graph.nodes.map((item) => item.id).join("|"), [graph.nodes]);

  useEffect(() => {
    setDragOffsets({});
  }, [graphSignature]);

  const laneCount = useMemo(() => {
    const lanes = graph.nodes.map((item) => Number(item.lane ?? 0));
    const maxLaneIndexFromLabels = laneLabels.length ? laneLabels.length - 1 : 0;
    return Math.max(maxLaneIndexFromLabels, ...lanes, 0) + 1;
  }, [graph.nodes, laneLabels.length]);

  const laneOrders = useMemo(() => {
    const grouped = new Map<number, number>();
    graph.nodes.forEach((node) => {
      const lane = Number(node.lane ?? 0);
      const count = grouped.get(lane) ?? 0;
      grouped.set(lane, Math.max(count, Number(node.order ?? 0) + 1));
    });
    return grouped;
  }, [graph.nodes]);

  const nodeSize = useMemo(() => {
    const raw = Math.floor((width - PADDING_X * 2) / Math.max(laneCount, 1) - 18);
    return Math.max(56, Math.min(66, raw));
  }, [laneCount, width]);

  const topInset = laneLabels.length ? PADDING_TOP + HEADER_HEIGHT : PADDING_TOP;

  const laneCenters = useMemo(() => {
    const inner = Math.max(0, width - PADDING_X * 2);
    const n = Math.max(laneCount, 1);
    return Array.from({ length: laneCount }).map((_, lane) => PADDING_X + (lane + 0.5) * (inner / n));
  }, [laneCount, width]);

  const basePoints = useMemo(() => {
    const map = new Map<string, Point>();
    const usableHeight = Math.max(92, height - topInset - PADDING_BOTTOM - nodeSize);
    graph.nodes.forEach((node) => {
      const lane = Math.max(0, Math.min(laneCount - 1, Number(node.lane ?? 0)));
      const order = Number(node.order ?? 0);
      const laneTotal = Math.max(1, laneOrders.get(lane) ?? 1);
      const stagger = laneTotal > 1 ? Math.min(24, Math.max(14, nodeSize * 0.34)) : 0;
      const xOffset = laneTotal > 1 ? (order - (laneTotal - 1) / 2) * stagger : 0;
      const x = (laneCenters[lane] ?? laneCenters[0] ?? width / 2) + xOffset;
      const y = topInset + nodeSize / 2 + usableHeight * ((order + 1) / (laneTotal + 1));
      map.set(node.id, { x, y });
    });
    return map;
  }, [graph.nodes, height, laneCenters, laneCount, laneOrders, nodeSize, topInset, width]);

  const points = useMemo(() => {
    const map = new Map<string, Point>();
    graph.nodes.forEach((node) => {
      const base = basePoints.get(node.id);
      if (!base) {
        return;
      }
      const drag = dragOffsets[node.id] ?? { x: 0, y: 0 };
      map.set(node.id, { x: base.x + drag.x, y: base.y + drag.y });
    });
    return map;
  }, [basePoints, dragOffsets, graph.nodes]);

  const highlightedSet = useMemo(() => new Set(graph.highlighted_path ?? []), [graph.highlighted_path]);

  const onLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  const bounds = useMemo(
    () => ({
      width,
      height,
      topInset,
    }),
    [height, topInset, width],
  );

  return (
    <View style={[styles.canvas, { height }]} onLayout={onLayout}>
      {laneLabels.length ? (
        <View style={styles.laneHeaderLayer} pointerEvents="none">
          {laneLabels.map((label, index) => {
            const centerX = laneCenters[index] ?? laneCenters[0] ?? width / 2;
            return (
              <View
                key={`${label}-${index}`}
                style={[
                  styles.lanePill,
                  {
                    left: centerX - 26,
                  },
                ]}
              >
                <Text style={styles.lanePillText} numberOfLines={1}>
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.gridOverlay} pointerEvents="none">
        {laneCenters.map((center, index) => (
          <View
            key={`grid-${index}`}
            style={[
              styles.gridColumn,
              {
                left: center,
              },
            ]}
          />
        ))}
      </View>

      {graph.edges.map((edge, index) => {
        const source = points.get(edge.source);
        const target = points.get(edge.target);
        if (!source || !target) {
          return null;
        }
        const tone = getTone(edge.tone);
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;

        return (
          <View key={edge.id} pointerEvents="none">
            <View
              style={[
                styles.edgeLine,
                {
                  width: length,
                  left: midX - length / 2,
                  top: midY - 1,
                  backgroundColor: tone.line,
                  transform: [{ rotateZ: `${angle}rad` }],
                },
              ]}
            />
            <EdgeFlow from={source} to={target} color={tone.ink} delay={(index * 0.18) % 1} />
          </View>
        );
      })}

      {graph.nodes.map((node) => {
        const basePoint = basePoints.get(node.id);
        if (!basePoint) {
          return null;
        }
        return (
          <GraphNodeBubble
            key={node.id}
            node={node}
            point={basePoint}
            size={nodeSize}
            bounds={bounds}
            highlighted={highlightedSet.has(node.id)}
            offset={dragOffsets[node.id] ?? { x: 0, y: 0 }}
            onOffsetChange={(nextOffset) =>
              setDragOffsets((prev) => ({
                ...prev,
                [node.id]: nextOffset,
              }))
            }
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    borderRadius: radius.lg,
    backgroundColor: "#F7FAFF",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#DFEAF8",
  },
  laneHeaderLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  lanePill: {
    position: "absolute",
    top: 8,
    width: 50,
    minHeight: 22,
    borderRadius: radius.pill,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DFEAF8",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  lanePillText: {
    color: "#6B86A8",
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  gridColumn: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    marginLeft: -0.5,
    backgroundColor: "rgba(47,112,230,0.06)",
  },
  edgeLine: {
    position: "absolute",
    height: 2,
    borderRadius: 999,
  },
  edgePulse: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  node: {
    position: "absolute",
    borderWidth: 1,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 8,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 10,
    zIndex: 3,
  },
  nodeHalo: {
    ...StyleSheet.absoluteFillObject,
  },
  nodeText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "900",
    fontFamily: fontFamily.body,
    textAlign: "center",
  },
});
