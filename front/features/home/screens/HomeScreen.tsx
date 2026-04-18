import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { palette } from "@/shared/theme";

import {
  primaryEntries,
  secondaryEntries,
} from "../config/functionCatalog";
import { HomeMoreFunctionsCard } from "../components/HomeMoreFunctionsCard";
import { HomePrimaryModesCard } from "../components/HomePrimaryModesCard";

export default function HomeScreen() {
  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.content}>
          <HomePrimaryModesCard entries={primaryEntries} />
          <HomeMoreFunctionsCard entries={secondaryEntries} />
        </View>
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
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 14,
  },
});
