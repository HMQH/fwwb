import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { detectionsApi } from "../api";
import type { PickedFile, WebPhishingPredictResponse, WebPhishingRiskLevel } from "../types";

const HTML_EXTENSIONS = new Set([".html", ".htm", ".txt"]);

function extOf(name: string) {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function normalizePickedFile(asset: { uri: string; name?: string | null; mimeType?: string | null }): PickedFile {
  return {
    uri: asset.uri,
    name: asset.name ?? "page.html",
    type: asset.mimeType ?? "text/html",
  };
}

function riskMeta(
  level: WebPhishingRiskLevel,
  isPhishing: boolean
): { label: string; tone: string; soft: string; icon: keyof typeof MaterialCommunityIcons.glyphMap } {
  switch (level) {
    case "high":
      return { label: "高风险", tone: "#D96A4A", soft: "#FFF0EA", icon: "shield-alert-outline" as const };
    case "medium":
      return { label: "中风险", tone: "#C48A29", soft: "#FFF7E8", icon: "shield-half-full" as const };
    case "suspicious":
      return { label: "可疑", tone: "#8A63D2", soft: "#F3EEFF", icon: "shield-star-outline" as const };
    case "safe":
    default:
      return isPhishing
        ? { label: "可疑", tone: "#8A63D2", soft: "#F3EEFF", icon: "shield-star-outline" as const }
        : { label: "安全", tone: "#2F70E6", soft: "#EAF2FF", icon: "shield-check-outline" as const };
  }
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function ResultCard({ result }: { result: WebPhishingPredictResponse }) {
  const meta = riskMeta(result.risk_level, result.is_phishing);
  return (
    <View style={styles.resultCard}>
      <View style={styles.resultHeader}>
        <View style={[styles.resultIconWrap, { backgroundColor: meta.soft }]}>
          <MaterialCommunityIcons name={meta.icon} size={22} color={meta.tone} />
        </View>
        <View style={styles.resultHeaderCopy}>
          <Text style={styles.resultTitle}>{meta.label}</Text>
          <Text style={styles.resultSubtitle}>{result.is_phishing ? "疑似钓鱼网站" : "暂未发现明显风险"}</Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>钓鱼概率</Text>
          <Text style={styles.metricValue}>{formatPercent(result.phish_prob)}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>模式</Text>
          <Text style={styles.metricValue}>{result.mode === "url_html" ? "URL + HTML" : "URL"}</Text>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>URL</Text>
        <Text style={styles.infoValue}>{result.url}</Text>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaChip}>
          <Text style={styles.metaChipText}>{result.model_name}</Text>
        </View>
        <View style={styles.metaChip}>
          <Text style={styles.metaChipText}>{`标签 ${result.pred_label}`}</Text>
        </View>
      </View>
    </View>
  );
}

export function WebPhishingScreen() {
  const { token } = useAuth();
  const [url, setUrl] = useState("");
  const [htmlText, setHtmlText] = useState("");
  const [htmlFile, setHtmlFile] = useState<PickedFile | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<WebPhishingPredictResponse | null>(null);

  const canSubmit = useMemo(() => Boolean(url.trim()) && !submitting, [submitting, url]);

  const pickHtmlFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: "*/*",
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    const name = asset.name ?? "page.html";
    const suffix = extOf(name);
    const mime = (asset.mimeType ?? "").toLowerCase();
    if (!(HTML_EXTENSIONS.has(suffix) || mime.includes("html") || mime.startsWith("text/"))) {
      Alert.alert("文件类型不支持", "请选择 .html / .htm / .txt");
      return;
    }
    setHtmlFile(normalizePickedFile(asset));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!token) {
      Alert.alert("未登录", "请先登录");
      return;
    }
    if (!url.trim()) {
      Alert.alert("缺少网址", "请输入网址");
      return;
    }

    setSubmitting(true);
    try {
      const nextResult = htmlFile
        ? await detectionsApi.predictWebPhishingUpload(token, {
            url: url.trim(),
            htmlFile,
            return_features: false,
          })
        : await detectionsApi.predictWebPhishing(token, {
            url: url.trim(),
            html: htmlText.trim() ? htmlText : null,
            return_features: false,
          });
      setResult(nextResult);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "检测失败";
      Alert.alert("检测失败", message);
    } finally {
      setSubmitting(false);
    }
  }, [htmlFile, htmlText, token, url]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons name="web-check" size={22} color={palette.accentStrong} />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>钓鱼网站检测</Text>
              <Text style={styles.heroSubtitle}>网址、源码、文件</Text>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>目标网址</Text>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              placeholder="https://example.com/login"
              placeholderTextColor={palette.inkSoft}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>HTML 文件</Text>
              <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={() => void pickHtmlFile()}>
                <MaterialCommunityIcons name="file-upload-outline" size={16} color={palette.accentStrong} />
                <Text style={styles.secondaryButtonText}>选择</Text>
              </Pressable>
            </View>
            {htmlFile ? (
              <View style={styles.fileRow}>
                <View style={styles.fileInfo}>
                  <MaterialCommunityIcons name="file-document-outline" size={18} color={palette.accentStrong} />
                  <Text style={styles.fileName} numberOfLines={2}>{htmlFile.name}</Text>
                </View>
                <Pressable style={({ pressed }) => [styles.removeChip, pressed && styles.buttonPressed]} onPress={() => setHtmlFile(null)}>
                  <MaterialCommunityIcons name="close" size={14} color={palette.ink} />
                </Pressable>
              </View>
            ) : (
              <Text style={styles.helperText}>未选择</Text>
            )}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>HTML 文本</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={htmlText}
              onChangeText={setHtmlText}
              placeholder="可选"
              placeholderTextColor={palette.inkSoft}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <Pressable
            style={({ pressed }) => [styles.submitButton, pressed && canSubmit && styles.buttonPressed, !canSubmit && styles.submitDisabled]}
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={palette.inkInverse} />
            ) : (
              <>
                <Text style={styles.submitButtonText}>开始检测</Text>
                <MaterialCommunityIcons name="arrow-right" size={16} color={palette.inkInverse} />
              </>
            )}
          </Pressable>

          {result ? <ResultCard result={result} /> : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, gap: 16 },
  heroCard: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    ...panelShadow,
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: { flex: 1, gap: 6 },
  heroTitle: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  heroSubtitle: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  sectionCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
    ...panelShadow,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  textarea: {
    minHeight: 180,
  },
  helperText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  fileRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  fileInfo: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  fileName: {
    flex: 1,
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  removeChip: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: palette.backgroundDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  submitButton: {
    minHeight: 46,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitButtonText: {
    color: palette.inkInverse,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  submitDisabled: { opacity: 0.6 },
  secondaryButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  secondaryButtonText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  resultCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    ...panelShadow,
  },
  resultHeader: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  resultIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  resultHeaderCopy: { flex: 1, gap: 6 },
  resultTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  resultSubtitle: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
  metricsRow: { flexDirection: "row", gap: 10 },
  metricCard: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  metricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  metricValue: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  infoCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  infoLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  infoValue: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
  },
  metaChipText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  buttonPressed: { opacity: 0.82 },
});
