import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth, type UserRole } from "@/features/auth";
import { palette } from "@/shared/theme";

import { HomeMascot } from "../components/HomeMascot";
import { HomeMoreFunctionsCard } from "../components/HomeMoreFunctionsCard";
import { HomePrimaryModesCard } from "../components/HomePrimaryModesCard";
import { primaryEntries, secondaryEntries } from "../config/functionCatalog";

function getScore(userRole: UserRole, guardianRelation: string | null) {
  const baseScore = {
    office_worker: 95,
    student: 96,
    mother: 95,
    investor: 94,
    minor: 97,
    young_social: 95,
    elder: 93,
    finance: 94,
  }[userRole];

  const relationBonus = guardianRelation && guardianRelation !== "self" ? 2 : 0;

  return Math.min(99, baseScore + relationBonus);
}

export default function HomeScreen() {
  const { user } = useAuth();

  const score = useMemo(() => {
    if (!user) {
      return 5;
    }
    return getScore(user.role, user.guardian_relation);
  }, [user]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <HomeMascot score={score} />
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
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 14,
  },
});
