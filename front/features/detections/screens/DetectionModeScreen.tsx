import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import Animated, { LinearTransition, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";
import { useReduceMotionEnabled } from "@/shared/useReduceMotionEnabled";

import { buildDetectionSubmitFormData, detectionsApi } from "../api";
import type { DetectionMode, PickedFile } from "../types";

type AppendixItem = PickedFile & { key: string };
type AppendixSlot = "text" | "audio" | "image" | "video";
type SectionAction = { key: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; onPress: () => void; };

const TEXT_EXT = new Set([".txt", ".pdf", ".md", ".json", ".csv", ".log", ".doc", ".docx"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac", ".opus", ".amr"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi", ".3gp", ".mpeg", ".mpg"]);

const modeConfig: Record<DetectionMode, { title: string; subtitle: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; placeholder: string; banner: string; fields: { text: boolean; textFiles: boolean; image: boolean; video: boolean; audio: boolean; }; }> = {
  text: { title: "文本检测", subtitle: "聊天、短信、链接文案。", icon: "message-text-outline", placeholder: "粘贴待检测文本", banner: "话术与文档可一起提交。", fields: { text: true, textFiles: true, image: false, video: false, audio: false } },
  visual: { title: "图 / 视频检测", subtitle: "截图、界面与短视频。", icon: "image-search-outline", placeholder: "", banner: "界面、二维码与录屏可一起提交。", fields: { text: false, textFiles: false, image: true, video: true, audio: false } },
  audio: { title: "音频检测", subtitle: "录音、语音消息、通话片段单独处理，尽量保留原始声音线索。", icon: "microphone-outline", placeholder: "", banner: "重点看催促、威胁、冒充客服等语音模式。", fields: { text: false, textFiles: false, image: false, video: false, audio: true } },
  mixed: { title: "混合检测", subtitle: "文本、图片、音频、视频一起交叉判断，适合复杂诈骗链路。", icon: "layers-triple-outline", placeholder: "补充核心聊天内容，有助于系统联动判断", banner: "按区块分别补充材料，便于系统交叉判断整条链路。", fields: { text: true, textFiles: false, image: true, video: true, audio: true } },
};

const nextKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const extOf = (name: string) => { const i = name.lastIndexOf("."); return i < 0 ? "" : name.slice(i).toLowerCase(); };
const isAllowedForSlot = (name: string, mime: string, slot: AppendixSlot) => {
  const suffix = extOf(name); const mimeType = mime.toLowerCase();
  if (slot === "image") return mimeType.startsWith("image/") || (suffix !== "" && IMAGE_EXT.has(suffix));
  if (slot === "video") return mimeType.startsWith("video/") || (suffix !== "" && VIDEO_EXT.has(suffix));
  if (slot === "audio") return mimeType.startsWith("audio/") || (suffix !== "" && AUDIO_EXT.has(suffix));
  if (mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/")) return false;
  return suffix !== "" && TEXT_EXT.has(suffix);
};
const isImageFile = (mime: string, name: string) => mime.toLowerCase().startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|heic|bmp)$/i.test(name);

function MotionPanel({ index, style, children }: { index: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const reduceMotion = useReduceMotionEnabled();
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) { progress.value = 1; return; }
    progress.value = 0;
    progress.value = withDelay(index * 72, withSpring(1, { damping: 18, stiffness: 190, mass: 0.9 }));
  }, [index, progress, reduceMotion]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(progress.value, [0, 1], [24, 0]) }, { scale: interpolate(progress.value, [0, 1], [0.95, 1]) }] }));
  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

function HeroSignal({ icon }: { icon: keyof typeof MaterialCommunityIcons.glyphMap }) {
  const reduceMotion = useReduceMotionEnabled();
  const orbit = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) { orbit.value = 0; return; }
    orbit.value = withRepeat(withSequence(withTiming(1, { duration: 1800 }), withTiming(0, { duration: 1800 })), -1, true);
  }, [orbit, reduceMotion]);
  const ringA = useAnimatedStyle(() => ({ transform: [{ rotate: `${-16 + orbit.value * 28}deg` }, { scale: 0.98 + orbit.value * 0.04 }] }));
  const ringB = useAnimatedStyle(() => ({ transform: [{ rotate: `${12 - orbit.value * 20}deg` }, { scale: 1.02 - orbit.value * 0.04 }] }));
  const chip = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(orbit.value, [0, 1], [-4, 6]) }, { translateX: interpolate(orbit.value, [0, 1], [-3, 5]) }] }));
  return <View style={styles.heroSignal}><Animated.View style={[styles.heroOrbitLarge, ringA]} /><Animated.View style={[styles.heroOrbitSmall, ringB]} /><Animated.View style={[styles.heroChipFloat, chip]} /><View style={styles.heroCore}><MaterialCommunityIcons name={icon} size={22} color={palette.accentStrong} /></View></View>;
}

function PreviewGrid({ items, onRemove, compact }: { items: AppendixItem[]; onRemove: (key: string) => void; compact?: boolean }) {
  const reduceMotion = useReduceMotionEnabled();
  if (!items.length) return null;
  return <View style={styles.previewGrid}>{items.map((item) => <Animated.View key={item.key} layout={reduceMotion ? undefined : LinearTransition.springify().damping(18).stiffness(210)} style={[styles.previewTile, compact && styles.previewTileCompact]}>{isImageFile(item.type, item.name) ? <Image source={{ uri: item.uri }} style={styles.previewImage} contentFit="cover" /> : <View style={styles.previewFile}><MaterialCommunityIcons name="file-outline" size={compact ? 18 : 22} color={palette.accentStrong} /></View>}<Text style={[styles.previewName, compact && styles.previewNameCompact]} numberOfLines={compact ? 1 : 2}>{item.name}</Text><Pressable style={({ pressed }) => [styles.previewRemove, pressed && styles.previewRemovePressed]} onPress={() => onRemove(item.key)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`移除 ${item.name}`}><MaterialCommunityIcons name="close" size={14} color={palette.ink} /></Pressable></Animated.View>)}</View>;
}

function SectionCard({ icon, title, subtitle, state, active, actions, children, style, compact }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; subtitle: string; state: string; active: boolean; actions?: SectionAction[]; children: ReactNode; style?: StyleProp<ViewStyle>; compact?: boolean }) {
  return <View style={[styles.section, active && styles.sectionActive, compact && styles.sectionCompact, style]}><View style={[styles.sectionHead, compact && styles.sectionHeadCompact]}><View style={[styles.sectionIcon, active && styles.sectionIconActive, compact && styles.sectionIconCompact]}><MaterialCommunityIcons name={icon} size={compact ? 16 : 18} color={palette.accentStrong} /></View><View style={styles.sectionCopy}><Text style={[styles.sectionTitle, compact && styles.sectionTitleCompact]}>{title}</Text>{compact ? null : <Text style={styles.sectionSub}>{subtitle}</Text>}</View><View style={[styles.sectionState, active && styles.sectionStateActive, compact && styles.sectionStateCompact]}><Text style={[styles.sectionStateText, active && styles.sectionStateTextActive, compact && styles.sectionStateTextCompact]}>{state}</Text></View></View>{actions && actions.length ? <View style={[styles.actionRow, compact && styles.actionRowCompact]}>{actions.map((action) => <Pressable key={action.key} style={({ pressed }) => [styles.actionChip, compact && styles.actionChipCompact, pressed && styles.actionPressed]} onPress={action.onPress}><MaterialCommunityIcons name={action.icon} size={compact ? 12 : 14} color={palette.accentStrong} /><Text style={[styles.actionLabel, compact && styles.actionLabelCompact]}>{action.label}</Text></Pressable>)}</View> : null}{children}</View>;
}

export function DetectionModeScreen({ mode }: { mode: DetectionMode }) {
  const router = useRouter();
  const { token } = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  const config = modeConfig[mode];
  const [textContent, setTextContent] = useState("");
  const [textFiles, setTextFiles] = useState<AppendixItem[]>([]);
  const [audioFiles, setAudioFiles] = useState<AppendixItem[]>([]);
  const [imageFiles, setImageFiles] = useState<AppendixItem[]>([]);
  const [videoFiles, setVideoFiles] = useState<AppendixItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const ingestAssets = useCallback((assets: { uri: string; name?: string | null; mimeType?: string | null }[], slot: AppendixSlot, setter: Dispatch<SetStateAction<AppendixItem[]>>) => {
    const valid: AppendixItem[] = []; const invalid: string[] = [];
    for (const asset of assets) {
      const name = asset.name ?? "file"; const mimeType = asset.mimeType ?? "application/octet-stream";
      if (!isAllowedForSlot(name, mimeType, slot)) { invalid.push(name); continue; }
      valid.push({ uri: asset.uri, name, type: mimeType, key: nextKey() });
    }
    if (invalid.length) Alert.alert("部分文件未添加", `以下文件不符合当前入口要求：\n${invalid.join("\n")}`);
    if (valid.length) setter((prev) => [...prev, ...valid]);
  }, []);

  const pickDocumentsForSlot = useCallback(async (slot: Extract<AppendixSlot, "text" | "audio" | "video">, setter: Dispatch<SetStateAction<AppendixItem[]>>) => {
    if (Platform.OS === "web") { Alert.alert("当前平台受限", "请优先在手机端选择文件。"); return; }
    const typeOption = slot === "audio" ? "audio/*" : slot === "video" ? "video/*" : undefined;
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true, ...(typeOption ? { type: typeOption } : {}) });
    if (!result.canceled && result.assets.length) ingestAssets(result.assets, slot, setter);
  }, [ingestAssets]);

  const pickImages = useCallback(async () => {
    if (Platform.OS === "web") { Alert.alert("当前平台受限", "请优先在手机端选择图片。"); return; }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert("需要相册权限", "请在系统设置中允许访问相册。"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 20, quality: 0.84 });
    if (!result.canceled && result.assets.length) ingestAssets(result.assets.map((asset) => ({ uri: asset.uri, name: asset.fileName ?? "image.jpg", mimeType: asset.mimeType ?? "image/jpeg" })), "image", setImageFiles);
  }, [ingestAssets]);

  const pickVideos = useCallback(async () => {
    if (Platform.OS === "web") { Alert.alert("当前平台受限", "请优先在手机端选择视频。"); return; }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert("需要相册权限", "请在系统设置中允许访问相册。"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], allowsMultipleSelection: true, selectionLimit: 10 });
    if (!result.canceled && result.assets.length) ingestAssets(result.assets.map((asset) => ({ uri: asset.uri, name: asset.fileName ?? "video.mp4", mimeType: asset.mimeType ?? "video/mp4" })), "video", setVideoFiles);
  }, [ingestAssets]);

  const trimmedText = textContent.trim();
  const resetForm = useCallback(() => { setTextContent(""); setTextFiles([]); setAudioFiles([]); setImageFiles([]); setVideoFiles([]); }, []);
  const hasPayload = useMemo(() => Boolean(trimmedText) || textFiles.length > 0 || audioFiles.length > 0 || imageFiles.length > 0 || videoFiles.length > 0, [audioFiles.length, imageFiles.length, textFiles.length, trimmedText, videoFiles.length]);
  const payloadCount = useMemo(() => (trimmedText ? 1 : 0) + textFiles.length + audioFiles.length + imageFiles.length + videoFiles.length, [audioFiles.length, imageFiles.length, textFiles.length, trimmedText, videoFiles.length]);
  const supported = useMemo(() => [config.fields.text && "文本", config.fields.textFiles && "文档", config.fields.image && "图片", config.fields.video && "视频", config.fields.audio && "音频"].filter(Boolean) as string[], [config.fields]);

  const sectionActions = useMemo(() => ({
    textFiles: config.fields.textFiles ? [{ key: "doc-more", icon: "plus", label: "加文档", onPress: () => void pickDocumentsForSlot("text", setTextFiles) }] : [],
    image: config.fields.image ? [{ key: "image-more", icon: "plus", label: "相册", onPress: () => void pickImages() }] : [],
    video: config.fields.video ? [{ key: "video-album", icon: "image-plus-outline", label: "相册", onPress: () => void pickVideos() }, { key: "video-file", icon: "folder-plus-outline", label: "文件", onPress: () => void pickDocumentsForSlot("video", setVideoFiles) }] : [],
    audio: config.fields.audio ? [{ key: "audio-more", icon: "plus", label: "继续添加音频", onPress: () => void pickDocumentsForSlot("audio", setAudioFiles) }] : [],
  }), [config.fields, pickDocumentsForSlot, pickImages, pickVideos]);

  const handleSubmit = useCallback(async () => {
    if (!token) { Alert.alert("未登录", "请先登录。"); return; }
    if (!hasPayload) { Alert.alert("缺少内容", "请至少添加一项检测内容。"); return; }
    const formData = buildDetectionSubmitFormData({ text_content: textContent, text_files: textFiles, audio_files: audioFiles, image_files: imageFiles, video_files: videoFiles });
    setSubmitting(true);
    try {
      await detectionsApi.submit(token, formData);
      resetForm();
      Alert.alert("提交成功", "材料已发送，后续可以继续补充新的检测内容。");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "提交失败，请稍后重试。";
      Alert.alert("提交失败", message);
    } finally { setSubmitting(false); }
  }, [audioFiles, hasPayload, imageFiles, resetForm, textContent, textFiles, token, videoFiles]);

  const pairLayout = config.fields.text && config.fields.textFiles;
  const visualPairLayout = Boolean(config.fields.image && config.fields.video && !config.fields.text && !config.fields.textFiles && !config.fields.audio);
  const pairTileSize = useMemo(() => {
    const horizontalPadding = 16 * 2;
    const gap = 10;
    return Math.max(120, (windowWidth - horizontalPadding - gap) / 2);
  }, [windowWidth]);
  const textSectionCount = pairLayout ? 1 : Number(config.fields.text) + Number(config.fields.textFiles);
  let k = 2 + textSectionCount;
  const panelVisualPair = visualPairLayout ? k++ : -1;
  const panelImage = !visualPairLayout && config.fields.image ? k++ : -1;
  const panelVideo = !visualPairLayout && config.fields.video ? k++ : -1;
  const panelAudio = config.fields.audio ? k++ : -1;
  const panelCommand = k;

  return <View style={styles.root}><View style={styles.orbTop} /><View style={styles.orbBottom} /><View style={styles.plate} /><SafeAreaView style={styles.safeArea} edges={["top"]}><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <MotionPanel index={0} style={styles.topBar}><Pressable style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="返回"><MaterialCommunityIcons name="chevron-left" size={18} color={palette.accentStrong} /><Text style={styles.backText}>返回</Text></Pressable><View style={styles.badge}><View style={styles.badgeDot} /><Text style={styles.badgeText}>{mode === "mixed" ? "多模态联判" : "单项专检"}</Text></View></MotionPanel>
    <MotionPanel index={1} style={styles.hero}><View style={styles.glowA} /><View style={styles.glowB} /><HeroSignal icon={config.icon} /><View style={styles.heroCopy}><Text style={styles.eyebrow}>检测工作台</Text><Text style={styles.heroTitle}>{config.title}</Text><Text style={styles.heroSubtitle}>{config.subtitle}</Text><View style={styles.metaRow}>{supported.map((label) => <View key={label} style={styles.metaChip}><Text style={styles.metaText}>{label}</Text></View>)}</View><Text style={styles.heroBanner}>{config.banner}</Text></View></MotionPanel>
    {pairLayout ? <MotionPanel index={2}><View style={styles.textPairRow}><View style={[styles.textPairCell, { width: pairTileSize, height: pairTileSize }]}><SectionCard compact icon="text-box-outline" title="文本" subtitle="" state={trimmedText ? `${trimmedText.length}字` : "空"} active={Boolean(trimmedText)} style={styles.textPairSection}><TextInput style={[styles.textArea, styles.textAreaPaired]} placeholder="粘贴文本" placeholderTextColor={palette.inkSoft} value={textContent} onChangeText={setTextContent} multiline textAlignVertical="top" /></SectionCard></View><View style={[styles.textPairCell, { width: pairTileSize, height: pairTileSize }]}><SectionCard compact icon="file-document-outline" title="附件" subtitle="" state={textFiles.length ? `${textFiles.length}个` : "空"} active={textFiles.length > 0} actions={sectionActions.textFiles as SectionAction[]} style={styles.textPairSection}><ScrollView style={styles.textPairAttachScroll} contentContainerStyle={styles.textPairAttachScrollContent} nestedScrollEnabled showsVerticalScrollIndicator={false}>{textFiles.length ? null : <View style={styles.emptyCompact}><Text style={styles.emptyTextCompact}>点「加文档」</Text></View>}<PreviewGrid compact items={textFiles} onRemove={(key) => setTextFiles((prev) => prev.filter((item) => item.key !== key))} /></ScrollView></SectionCard></View></View></MotionPanel> : null}
    {!pairLayout && config.fields.text ? <MotionPanel index={2}><SectionCard icon="text-box-outline" title="文本内容" subtitle={mode === "mixed" ? "补关键聊天内容，帮助系统交叉判断。" : "把核心话术直接贴进来。"} state={trimmedText ? `${trimmedText.length} 字` : "待补充"} active={Boolean(trimmedText)}><TextInput style={styles.textArea} placeholder={config.placeholder} placeholderTextColor={palette.inkSoft} value={textContent} onChangeText={setTextContent} multiline textAlignVertical="top" /></SectionCard></MotionPanel> : null}
    {!pairLayout && config.fields.textFiles ? <MotionPanel index={config.fields.text ? 3 : 2}><SectionCard icon="file-document-outline" title="文本附件" subtitle="聊天记录、文档或日志。" state={textFiles.length ? `${textFiles.length} 项` : "待添加"} active={textFiles.length > 0} actions={sectionActions.textFiles as SectionAction[]}>{textFiles.length ? null : <View style={styles.empty}><Text style={styles.emptyText}>点「加文档」上传。</Text></View>}<PreviewGrid items={textFiles} onRemove={(key) => setTextFiles((prev) => prev.filter((item) => item.key !== key))} /></SectionCard></MotionPanel> : null}
    {visualPairLayout ? <MotionPanel index={panelVisualPair}><View style={styles.textPairRow}><View style={[styles.textPairCell, { width: pairTileSize, height: pairTileSize }]}><SectionCard compact icon="image-outline" title="图片" subtitle="" state={imageFiles.length ? `${imageFiles.length}张` : "空"} active={imageFiles.length > 0} actions={sectionActions.image as SectionAction[]} style={styles.textPairSection}><ScrollView style={styles.textPairAttachScroll} contentContainerStyle={styles.textPairAttachScrollContent} nestedScrollEnabled showsVerticalScrollIndicator={false}>{imageFiles.length ? null : <View style={styles.emptyCompact}><Text style={styles.emptyTextCompact}>点「相册」</Text></View>}<PreviewGrid compact items={imageFiles} onRemove={(key) => setImageFiles((prev) => prev.filter((item) => item.key !== key))} /></ScrollView></SectionCard></View><View style={[styles.textPairCell, { width: pairTileSize, height: pairTileSize }]}><SectionCard compact icon="video-outline" title="视频" subtitle="" state={videoFiles.length ? `${videoFiles.length}条` : "空"} active={videoFiles.length > 0} actions={sectionActions.video as SectionAction[]} style={styles.textPairSection}><ScrollView style={styles.textPairAttachScroll} contentContainerStyle={styles.textPairAttachScrollContent} nestedScrollEnabled showsVerticalScrollIndicator={false}>{videoFiles.length ? null : <View style={styles.emptyCompact}><Text style={styles.emptyTextCompact}>相册或「文件」</Text></View>}<PreviewGrid compact items={videoFiles} onRemove={(key) => setVideoFiles((prev) => prev.filter((item) => item.key !== key))} /></ScrollView></SectionCard></View></View></MotionPanel> : null}
    {!visualPairLayout && config.fields.image ? <MotionPanel index={panelImage}><SectionCard icon="image-outline" title="图片素材" subtitle="截图、海报、转账页等。" state={imageFiles.length ? `${imageFiles.length} 项` : "待添加"} active={imageFiles.length > 0} actions={sectionActions.image as SectionAction[]}>{imageFiles.length ? null : <View style={styles.empty}><Text style={styles.emptyText}>点「相册」选图。</Text></View>}<PreviewGrid items={imageFiles} onRemove={(key) => setImageFiles((prev) => prev.filter((item) => item.key !== key))} /></SectionCard></MotionPanel> : null}
    {!visualPairLayout && config.fields.video ? <MotionPanel index={panelVideo}><SectionCard icon="video-outline" title="视频素材" subtitle="相册或本地文件。" state={videoFiles.length ? `${videoFiles.length} 项` : "待添加"} active={videoFiles.length > 0} actions={sectionActions.video as SectionAction[]}>{videoFiles.length ? null : <View style={styles.empty}><Text style={styles.emptyText}>点「相册」或「文件」。</Text></View>}<PreviewGrid items={videoFiles} onRemove={(key) => setVideoFiles((prev) => prev.filter((item) => item.key !== key))} /></SectionCard></MotionPanel> : null}
    {config.fields.audio ? <MotionPanel index={panelAudio}><SectionCard icon="microphone-outline" title="音频素材" subtitle="适合语音消息、电话录音、客服通话等音频内容。" state={audioFiles.length ? `${audioFiles.length} 项` : "待添加"} active={audioFiles.length > 0} actions={sectionActions.audio as SectionAction[]}>{audioFiles.length ? null : <View style={styles.empty}><Text style={styles.emptyText}>尽量保留原音，不要二次剪辑，利于判断催促与冒充语气。</Text></View>}<PreviewGrid items={audioFiles} onRemove={(key) => setAudioFiles((prev) => prev.filter((item) => item.key !== key))} /></SectionCard></MotionPanel> : null}
    <MotionPanel index={panelCommand} style={styles.command}><View style={styles.commandCopy}><Text style={styles.commandTitle}>{hasPayload ? `已准备 ${payloadCount} 项检测材料` : "先补充至少一项材料"}</Text><Text style={styles.commandSub}>{hasPayload ? "现在可以直接发起检测，后续仍可继续补充新的线索。" : "文本、图片、音频、视频任一入口都可以先开始。"}</Text></View><Pressable style={({ pressed }) => [styles.submit, pressed && !submitting && styles.submitPressed, submitting && styles.submitDisabled]} onPress={() => void handleSubmit()} disabled={submitting}>{submitting ? <ActivityIndicator size="small" color={palette.inkInverse} /> : <><Text style={styles.submitText}>开始检测</Text><MaterialCommunityIcons name="arrow-right" size={16} color={palette.inkInverse} /></>}</Pressable></MotionPanel>
  </ScrollView></SafeAreaView></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  safeArea: { flex: 1 },
  orbTop: { position: "absolute", top: -120, right: -70, width: 280, height: 280, borderRadius: 999, backgroundColor: "rgba(133,185,255,0.18)" },
  orbBottom: { position: "absolute", left: -92, bottom: 100, width: 250, height: 250, borderRadius: 999, backgroundColor: "rgba(203,222,255,0.2)" },
  plate: { position: "absolute", top: 180, left: 24, right: 24, height: 360, borderRadius: 40, backgroundColor: "rgba(255,255,255,0.22)", transform: [{ rotate: "-6deg" }] },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 14 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.9)", borderWidth: 1, borderColor: palette.line },
  backPressed: { transform: [{ scale: 0.98 }] },
  backText: { color: palette.accentStrong, fontSize: 13, lineHeight: 18, fontWeight: "700", fontFamily: fontFamily.body },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.82)", borderWidth: 1, borderColor: "rgba(157,187,227,0.65)" },
  badgeDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: palette.accentStrong },
  badgeText: { color: palette.ink, fontSize: 12, lineHeight: 16, fontWeight: "700", fontFamily: fontFamily.body },
  hero: { overflow: "hidden", borderRadius: 30, backgroundColor: palette.surface, borderWidth: 1, borderColor: "rgba(214,228,250,0.92)", paddingHorizontal: 18, paddingVertical: 18, flexDirection: "row", alignItems: "center", gap: 16, ...panelShadow },
  glowA: { position: "absolute", top: -42, right: -30, width: 160, height: 160, borderRadius: 999, backgroundColor: "rgba(88,150,255,0.12)" },
  glowB: { position: "absolute", bottom: -36, left: -30, width: 110, height: 110, borderRadius: 999, backgroundColor: "rgba(180,210,255,0.2)" },
  heroSignal: { width: 88, height: 88, alignItems: "center", justifyContent: "center" },
  heroOrbitLarge: { position: "absolute", width: 86, height: 86, borderRadius: 999, borderWidth: 8, borderColor: "transparent", borderTopColor: "#7FB1FF", borderRightColor: "#D7E7FF" },
  heroOrbitSmall: { position: "absolute", width: 62, height: 62, borderRadius: 999, borderWidth: 6, borderColor: "transparent", borderTopColor: "#B7D1FF", borderLeftColor: "#E8F2FF" },
  heroChipFloat: { position: "absolute", top: 10, right: 6, width: 14, height: 14, borderRadius: 999, backgroundColor: "#D6E6FF" },
  heroCore: { width: 46, height: 46, borderRadius: 18, backgroundColor: palette.accentSoft, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.7)" },
  heroCopy: { flex: 1, gap: 6 },
  eyebrow: { color: palette.accentStrong, fontSize: 12, lineHeight: 16, fontWeight: "800", fontFamily: fontFamily.body },
  heroTitle: { color: palette.ink, fontSize: 22, lineHeight: 28, fontWeight: "900", fontFamily: fontFamily.display },
  heroSubtitle: { color: palette.ink, fontSize: 13, lineHeight: 19, fontFamily: fontFamily.body },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 },
  metaChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: "rgba(230,240,255,0.9)" },
  metaText: { color: palette.accentStrong, fontSize: 11, lineHeight: 14, fontWeight: "700", fontFamily: fontFamily.body },
  heroBanner: { color: palette.inkSoft, fontSize: 12, lineHeight: 18, fontFamily: fontFamily.body },
  textPairRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 10 },
  textPairCell: { minWidth: 0 },
  textPairSection: { flex: 1, minHeight: 0, overflow: "hidden" },
  textPairAttachScroll: { flex: 1, minHeight: 0 },
  textPairAttachScrollContent: { flexGrow: 1, paddingBottom: 4 },
  section: { borderRadius: 28, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 16, paddingVertical: 16, gap: 14, ...panelShadow },
  sectionCompact: { borderRadius: 18, paddingHorizontal: 10, paddingVertical: 10, gap: 8 },
  sectionActive: { borderColor: "#BCD3FF" },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  sectionHeadCompact: { gap: 8 },
  sectionIcon: { width: 38, height: 38, borderRadius: 15, backgroundColor: palette.accentSoft, alignItems: "center", justifyContent: "center" },
  sectionIconCompact: { width: 28, height: 28, borderRadius: 11 },
  sectionIconActive: { backgroundColor: "#DDEBFF" },
  sectionCopy: { flex: 1, gap: 2 },
  sectionTitle: { color: palette.ink, fontSize: 15, lineHeight: 20, fontWeight: "900", fontFamily: fontFamily.display },
  sectionTitleCompact: { fontSize: 13, lineHeight: 18 },
  sectionSub: { color: palette.inkSoft, fontSize: 12, lineHeight: 17, fontFamily: fontFamily.body },
  sectionState: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: "#F3F7FF" },
  sectionStateCompact: { paddingHorizontal: 7, paddingVertical: 4 },
  sectionStateActive: { backgroundColor: "#E6F0FF" },
  sectionStateText: { color: palette.inkSoft, fontSize: 11, lineHeight: 14, fontWeight: "700", fontFamily: fontFamily.body },
  sectionStateTextCompact: { fontSize: 10, lineHeight: 12 },
  sectionStateTextActive: { color: palette.accentStrong },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionRowCompact: { gap: 6 },
  actionChip: { minHeight: 38, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: "#F5F8FF", borderWidth: 1, borderColor: palette.line, flexDirection: "row", alignItems: "center", gap: 6 },
  actionChipCompact: { minHeight: 30, paddingHorizontal: 8, gap: 4 },
  actionPressed: { transform: [{ scale: 0.98 }] },
  actionLabel: { color: palette.accentStrong, fontSize: 12, lineHeight: 16, fontWeight: "700", fontFamily: fontFamily.body },
  actionLabelCompact: { fontSize: 11, lineHeight: 14 },
  textArea: { minHeight: 156, borderRadius: 22, backgroundColor: "#F6F9FF", borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, paddingVertical: 14, color: palette.ink, fontSize: 14, lineHeight: 21, fontFamily: fontFamily.body },
  textAreaPaired: { flex: 1, minHeight: 0, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, lineHeight: 18 },
  empty: { borderRadius: 20, backgroundColor: "#F7FAFF", paddingHorizontal: 14, paddingVertical: 14 },
  emptyCompact: { borderRadius: 12, backgroundColor: "#F7FAFF", paddingHorizontal: 8, paddingVertical: 8, marginBottom: 6 },
  emptyText: { color: palette.inkSoft, fontSize: 12, lineHeight: 18, fontFamily: fontFamily.body },
  emptyTextCompact: { color: palette.inkSoft, fontSize: 11, lineHeight: 15, fontFamily: fontFamily.body, textAlign: "center" },
  previewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  previewTile: { width: "48.4%", borderRadius: 20, backgroundColor: "#F7FAFF", borderWidth: 1, borderColor: palette.line, padding: 10, gap: 8 },
  previewTileCompact: { width: "100%", padding: 6, gap: 4, borderRadius: 12 },
  previewNameCompact: { fontSize: 11, lineHeight: 14, paddingRight: 22 },
  previewImage: { width: "100%", aspectRatio: 1.12, borderRadius: 15, backgroundColor: palette.surfaceStrong },
  previewFile: { width: "100%", aspectRatio: 1.12, borderRadius: 15, backgroundColor: "#EAF3FF", alignItems: "center", justifyContent: "center" },
  previewName: { color: palette.ink, fontSize: 12, lineHeight: 17, fontFamily: fontFamily.body, paddingRight: 26 },
  previewRemove: { position: "absolute", top: 8, right: 8, width: 24, height: 24, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.line },
  previewRemovePressed: { transform: [{ scale: 0.96 }] },
  command: { borderRadius: 30, backgroundColor: palette.surface, borderWidth: 1, borderColor: "#C8D9F5", paddingHorizontal: 16, paddingVertical: 16, gap: 14, ...panelShadow },
  commandCopy: { gap: 4 },
  commandTitle: { color: palette.ink, fontSize: 16, lineHeight: 22, fontWeight: "900", fontFamily: fontFamily.display },
  commandSub: { color: palette.inkSoft, fontSize: 12, lineHeight: 18, fontFamily: fontFamily.body },
  submit: { minHeight: 54, borderRadius: 22, backgroundColor: palette.accentStrong, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, ...panelShadow },
  submitPressed: { transform: [{ scale: 0.985 }, { translateY: 1 }] },
  submitDisabled: { opacity: 0.82 },
  submitText: { color: palette.inkInverse, fontSize: 15, lineHeight: 20, fontWeight: "800", fontFamily: fontFamily.body },
});
