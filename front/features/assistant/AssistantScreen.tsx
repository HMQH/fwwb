import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { fontFamily, palette, radius } from "@/shared/theme";

import Composer from "./components/Composer";
import HistoryDrawer from "./components/HistoryDrawer";
import MessageBubble from "./components/MessageBubble";
import RelationPickerSheet from "./components/RelationPickerSheet";
import type { AssistantDraftAttachment, AssistantMessage, AssistantAttachmentKind } from "./types";
import { useAssistantConversation } from "./useAssistantConversation";

const TEXT_EXT = new Set([".txt", ".md", ".json", ".csv", ".log", ".html", ".htm", ".pdf", ".doc", ".docx"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac", ".opus", ".amr"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v", ".3gp"]);

function extOf(name: string) {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function inferAttachmentKind(name: string, mimeType: string): AssistantAttachmentKind {
  const suffix = extOf(name);
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/") || IMAGE_EXT.has(suffix)) {
    return "image";
  }
  if (mime.startsWith("video/") || VIDEO_EXT.has(suffix)) {
    return "video";
  }
  if (mime.startsWith("audio/") || AUDIO_EXT.has(suffix)) {
    return "audio";
  }
  if (TEXT_EXT.has(suffix)) {
    return "text";
  }
  return "text";
}

function nextAttachmentId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function AttachmentDraftBar({
  items,
  onRemove,
}: {
  items: AssistantDraftAttachment[];
  onRemove: (id: string) => void;
}) {
  if (!items.length) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.attachmentDraftRow}
    >
      {items.map((item) => (
        <View key={item.id} style={styles.attachmentDraftChip}>
          <MaterialCommunityIcons
            name={item.kind === "image" ? "image-outline" : item.kind === "audio" ? "microphone-outline" : item.kind === "video" ? "video-outline" : "file-outline"}
            size={16}
            color={palette.accentStrong}
          />
          <Text style={styles.attachmentDraftText} numberOfLines={1}>
            {item.name}
          </Text>
          <Pressable onPress={() => onRemove(item.id)} hitSlop={10}>
            <MaterialCommunityIcons name="close" size={16} color={palette.inkSoft} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

export default function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<AssistantMessage> | null>(null);
  const [draft, setDraft] = useState("");
  const [historyVisible, setHistoryVisible] = useState(false);
  const [relationPickerVisible, setRelationPickerVisible] = useState(false);
  const [draftAttachments, setDraftAttachments] = useState<AssistantDraftAttachment[]>([]);
  const [composerHeight, setComposerHeight] = useState(92);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const { token } = useAuth();
  const {
    session,
    sessions,
    relations,
    selectedRelationId,
    messages,
    loading,
    sending,
    error,
    bootstrap,
    openSession,
    createNewSession,
    selectRelation,
    sendMessage,
  } = useAssistantConversation(token);

  const relationNameMap = useMemo(
    () =>
      Object.fromEntries(
        relations.map((item) => [item.id, item.name])
      ),
    [relations]
  );

  const activeRelation = useMemo(
    () => relations.find((item) => item.id === selectedRelationId) ?? null,
    [relations, selectedRelationId]
  );

  const relationButtonLabel = activeRelation?.name ?? "对象";
  // Tab 场景已在 Tab 栏之上，勿再叠加 tabBarHeight；键盘弹出时 Tab 隐藏，需留出底部安全区。
  const composerBottomInset = keyboardVisible ? Math.max(insets.bottom, 8) : 0;
  const listBottomInset = composerHeight + 8;
  const scrollToLatest = useCallback((animated: boolean) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!messages.length) {
      return;
    }
    scrollToLatest(true);
  }, [messages.length, scrollToLatest]);

  useEffect(() => {
    if (!messages.length || !keyboardVisible) {
      return;
    }
    scrollToLatest(false);
  }, [composerHeight, keyboardVisible, messages.length, scrollToLatest]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const ingestFiles = useCallback(
    (assets: { uri: string; name?: string | null; mimeType?: string | null }[]) => {
      setDraftAttachments((prev) => {
        const next = [...prev];
        for (const asset of assets) {
          const name = asset.name ?? "附件";
          const type = asset.mimeType ?? "application/octet-stream";
          const exists = next.some((item) => item.uri === asset.uri && item.name === name);
          if (exists) {
            continue;
          }
          next.push({
            id: nextAttachmentId(),
            uri: asset.uri,
            name,
            type,
            kind: inferAttachmentKind(name, type),
          });
        }
        return next;
      });
    },
    []
  );

  const pickDocuments = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets.length) {
      ingestFiles(result.assets);
    }
  }, [ingestFiles]);

  const pickImages = useCallback(async () => {
    if (Platform.OS === "web") {
      await pickDocuments();
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相册权限", "请先开启相册权限");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 9,
      quality: 0.9,
    });
    if (!result.canceled && result.assets.length) {
      ingestFiles(
        result.assets.map((item) => ({
          uri: item.uri,
          name: item.fileName ?? "image.jpg",
          mimeType: item.mimeType ?? "image/jpeg",
        }))
      );
    }
  }, [ingestFiles, pickDocuments]);

  const handlePickAttachment = useCallback(() => {
    Alert.alert("添加附件", "选择来源", [
      { text: "图片", onPress: () => void pickImages() },
      { text: "文件", onPress: () => void pickDocuments() },
      { text: "取消", style: "cancel" },
    ]);
  }, [pickDocuments, pickImages]);

  const handleSend = useCallback(async () => {
    if (!draft.trim() && draftAttachments.length === 0) {
      return;
    }

    const preservedText = draft;
    const preservedAttachments = draftAttachments;
    setDraft("");
    setDraftAttachments([]);

    const ok = await sendMessage(preservedText, preservedAttachments);
    if (!ok) {
      setDraft(preservedText);
      setDraftAttachments(preservedAttachments);
    }
  }, [draft, draftAttachments, sendMessage]);

  const handleCreateNew = useCallback(async () => {
    setDraft("");
    setDraftAttachments([]);
    setHistoryVisible(false);
    setRelationPickerVisible(false);
    await createNewSession(selectedRelationId);
  }, [createNewSession, selectedRelationId]);

  const handleOpenSession = useCallback(
    async (sessionId: string) => {
      setHistoryVisible(false);
      await openSession(sessionId);
    },
    [openSession]
  );

  const handleSelectRelation = useCallback(
    async (relationId: string | null) => {
      setRelationPickerVisible(false);
      await selectRelation(relationId);
    },
    [selectRelation]
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <KeyboardAvoidingView
          style={styles.safeArea}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 16}
        >
          <View style={styles.container}>
            <View style={styles.header}>
              <Pressable style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]} onPress={() => setHistoryVisible(true)}>
                <MaterialCommunityIcons name="menu" size={22} color={palette.ink} />
              </Pressable>

              <Text style={styles.title}>反诈助手</Text>

              <View style={styles.headerActions}>
                <Pressable
                  style={({ pressed }) => [styles.headerChip, pressed && styles.pressed]}
                  onPress={() => setRelationPickerVisible(true)}
                  disabled={loading || sending}
                >
                  <MaterialCommunityIcons name="account-circle-outline" size={18} color={palette.ink} />
                  <Text style={styles.headerChipText} numberOfLines={1}>
                    {relationButtonLabel}
                  </Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}
                  onPress={() => void handleCreateNew()}
                  disabled={loading || sending}
                >
                  <MaterialCommunityIcons name="plus" size={22} color={palette.ink} />
                </Pressable>
              </View>
            </View>

            <View style={styles.listWrap}>
              {loading && messages.length === 0 ? (
                <View style={styles.centerState}>
                  <ActivityIndicator size="small" color={palette.accentStrong} />
                </View>
              ) : (
                <FlatList
                  ref={listRef}
                  data={messages}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => <MessageBubble message={item} />}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                  contentInsetAdjustmentBehavior="automatic"
                  contentContainerStyle={[styles.listContent, { paddingBottom: listBottomInset }]}
                />
              )}
            </View>

            <View
              style={[styles.bottomArea, { paddingBottom: composerBottomInset }]}
              onLayout={(event) => {
                const nextHeight = Math.ceil(event.nativeEvent.layout.height);
                if (Math.abs(nextHeight - composerHeight) > 1) {
                  setComposerHeight(nextHeight);
                }
              }}
            >
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <AttachmentDraftBar
                items={draftAttachments}
                onRemove={(id) => setDraftAttachments((prev) => prev.filter((item) => item.id !== id))}
              />
              <Composer
                value={draft}
                onChange={setDraft}
                onSend={() => void handleSend()}
                onPickAttachment={handlePickAttachment}
                hasAttachment={draftAttachments.length > 0}
                disabled={loading || sending}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <HistoryDrawer
        visible={historyVisible}
        sessions={sessions}
        activeSessionId={session?.id}
        relationNameMap={relationNameMap}
        onClose={() => setHistoryVisible(false)}
        onOpenSession={(sessionId) => void handleOpenSession(sessionId)}
        onCreateNew={() => void handleCreateNew()}
      />

      <RelationPickerSheet
        visible={relationPickerVisible}
        relations={relations}
        selectedRelationId={selectedRelationId}
        onClose={() => setRelationPickerVisible(false)}
        onSelect={(relationId) => void handleSelectRelation(relationId)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
    gap: 10,
  },
  title: {
    flex: 1,
    color: "#1F2837",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    fontFamily: fontFamily.display,
    textAlign: "center",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  headerChip: {
    maxWidth: 124,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: "#F4F7FC",
  },
  headerChipText: {
    flexShrink: 1,
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
    fontWeight: "700",
  },
  listWrap: {
    flex: 1,
  },
  listContent: {
    paddingTop: 14,
    paddingBottom: 16,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomArea: {
    paddingTop: 4,
    backgroundColor: "#FFFFFF",
  },
  attachmentDraftRow: {
    gap: 8,
    paddingVertical: 4,
    paddingRight: 8,
  },
  attachmentDraftChip: {
    maxWidth: 210,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: "#F4F7FC",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  attachmentDraftText: {
    flexShrink: 1,
    color: "#425166",
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  errorText: {
    color: "#D15B5B",
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
    paddingBottom: 6,
  },
  pressed: {
    opacity: 0.88,
  },
});
