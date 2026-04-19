import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { palette } from "@/shared/theme";

import { homeApi, type WateringRewardSource } from "../api";
import { HomeMoreFunctionsCard } from "../components/HomeMoreFunctionsCard";
import { HomePrimaryModesCard } from "../components/HomePrimaryModesCard";
import { HomeWateringHero } from "../components/HomeWateringHero";
import { primaryEntries, secondaryEntries } from "../config/functionCatalog";

function normalizeSafetyScore(value: number | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 95;
  }
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export default function HomeScreen() {
  const { user, token, refreshCurrentUser } = useAuth();
  const safetyScore = normalizeSafetyScore(user?.safety_score);

  const [waterBaseTotal, setWaterBaseTotal] = useState(0);
  const [pendingUnits, setPendingUnits] = useState(0);
  const [collecting, setCollecting] = useState(false);

  const syncWateringStatus = useCallback(async () => {
    if (!token) {
      setWaterBaseTotal(0);
      setPendingUnits(0);
      return;
    }
    try {
      const status = await homeApi.getWateringStatus(token);
      setWaterBaseTotal(Math.max(0, Math.round(status.water_total)));
      setPendingUnits(Math.max(0, Math.round(status.pending_units)));
    } catch {
      // 奖励接口失败不阻断首页
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void refreshCurrentUser();
      void syncWateringStatus();
    }, [refreshCurrentUser, syncWateringStatus])
  );

  const handleCollectOne = useCallback(async () => {
    if (!token || collecting || pendingUnits <= 0) {
      return null;
    }
    setCollecting(true);
    try {
      const result = await homeApi.claimWateringRewards(token, 1);
      setPendingUnits(Math.max(0, Math.round(result.pending_units)));
      const baseBeforeClaim = Math.max(
        0,
        Math.round(result.water_total - Math.max(0, result.claimed_units))
      );
      setWaterBaseTotal(baseBeforeClaim);

      const first = result.events[0];
      if (!first) {
        return null;
      }
      return {
        source: first.source as WateringRewardSource,
        units: Math.max(1, Math.round(first.units || 1)),
      };
    } catch {
      return null;
    } finally {
      setCollecting(false);
    }
  }, [collecting, pendingUnits, token]);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={["#FDFEFF", "#F4F8FF", "#EDF4FF"]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.backdrop}>
        <LinearGradient
          colors={["rgba(104, 175, 255, 0.18)", "rgba(104, 175, 255, 0.03)", "rgba(104, 175, 255, 0)"]}
          start={{ x: 0.1, y: 0.1 }}
          end={{ x: 0.9, y: 0.9 }}
          style={[styles.glowOrb, styles.glowOrbTop]}
        />
        <LinearGradient
          colors={["rgba(142, 186, 255, 0.15)", "rgba(142, 186, 255, 0.04)", "rgba(142, 186, 255, 0)"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[styles.glowOrb, styles.glowOrbMiddle]}
        />
        <LinearGradient
          colors={["rgba(255, 255, 255, 0.86)", "rgba(255, 255, 255, 0.14)", "rgba(255, 255, 255, 0)"]}
          start={{ x: 0.2, y: 0.2 }}
          end={{ x: 0.8, y: 1 }}
          style={[styles.glowOrb, styles.glowOrbBottom]}
        />
      </View>

      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <HomeWateringHero
            score={safetyScore}
            baseWaterTotal={waterBaseTotal}
            pendingUnits={pendingUnits}
            collecting={collecting}
            onCollectOne={handleCollectOne}
          />
          <HomePrimaryModesCard entries={primaryEntries} />
          <HomeMoreFunctionsCard entries={secondaryEntries} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  safeArea: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  glowOrb: {
    position: "absolute",
    borderRadius: 999,
  },
  glowOrbTop: {
    width: 280,
    height: 280,
    top: -42,
    left: -88,
    transform: [{ scaleX: 1.15 }],
  },
  glowOrbMiddle: {
    width: 240,
    height: 240,
    top: 210,
    right: -76,
  },
  glowOrbBottom: {
    width: 320,
    height: 320,
    bottom: -104,
    left: 24,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 18,
    gap: 10,
  },
});
