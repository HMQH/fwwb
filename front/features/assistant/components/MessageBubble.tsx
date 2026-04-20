import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { resolveUploadFileUrl } from "@/shared/api";
import { fontFamily, palette, radius } from "@/shared/theme";
import { ManagedImage as Image } from "@/shared/ui/ManagedImage";

import { AssistantExecutionBlock } from "./AssistantExecutionBlock";
import {
  getAssistantExecution,
  getAssistantMessageAttachments,
  type AssistantAttachment,
  type AssistantClarifyOption,
  type AssistantMessage,
} from "../types";

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function resolveAttachmentUri(item: AssistantAttachment) {
  if (item.uri) {
    return item.uri;
  }
  return resolveUploadFileUrl(item.file_path);
}

function isImageAttachment(item: AssistantAttachment) {
  return item.upload_type === "image" || item.mime_type?.startsWith("image/") === true;
}

function AttachmentList({
  items,
  isUser,
}: {
  items: AssistantAttachment[];
  isUser: boolean;
}) {
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);

  const imageItems = useMemo(() => items.filter(isImageAttachment), [items]);
  const fileItems = useMemo(() => items.filter((item) => !isImageAttachment(item)), [items]);

  return (
    <>
      <View style={styles.attachmentWrap}>
        {imageItems.length ? (
          <View style={styles.imageGrid}>
            {imageItems.map((item) => {
              const uri = resolveAttachmentUri(item);
              return (
                <Pressable
                  key={`${item.file_path}-${item.name}-${uri}`}
                  style={({ pressed }) => [styles.imageCard, pressed && styles.pressed]}
                  onPress={() => {
                    if (!uri) {
                      return;
                    }
                    setPreviewUri(uri);
                    setPreviewTitle(item.name);
                  }}
                >
                  {uri ? <Image source={{ uri }} style={styles.image} contentFit="cover" imagePreset="tile" /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {fileItems.length ? (
          <View style={styles.fileList}>
            {fileItems.map((item) => (
              <Pressable
                key={`${item.file_path}-${item.name}`}
                style={({ pressed }) => [
                  styles.fileChip,
                  isUser ? styles.userFileChip : styles.assistantFileChip,
                  pressed && styles.pressed,
                ]}
                onPress={() => {
                  const uri = resolveAttachmentUri(item);
                  if (uri) {
                    void Linking.openURL(uri);
                  }
                }}
              >
                <MaterialCommunityIcons
                  name="file-outline"
                  size={16}
                  color={isUser ? "rgba(255,255,255,0.88)" : palette.accentStrong}
                />
                <Text style={[styles.fileChipText, isUser && styles.userFileChipText]} numberOfLines={1}>
                  {item.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <Modal visible={Boolean(previewUri)} transparent animationType="fade" onRequestClose={() => setPreviewUri(null)}>
        <View style={styles.previewBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewUri(null)} />
          <View style={styles.previewCard}>
            <View style={styles.previewHead}>
              <Text style={styles.previewTitle} numberOfLines={2}>
                {previewTitle ?? "图片预览"}
              </Text>
              <Pressable style={({ pressed }) => [styles.previewClose, pressed && styles.pressed]} onPress={() => setPreviewUri(null)}>
                <Text style={styles.previewCloseText}>关闭</Text>
              </Pressable>
            </View>
            {previewUri ? <Image source={{ uri: previewUri }} style={styles.previewImage} contentFit="contain" imagePreset="detail" /> : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

export default function MessageBubble({
  message,
  onPressQuickAction,
  quickActionDisabled,
}: {
  message: AssistantMessage;
  onPressQuickAction?: (option: AssistantClarifyOption) => void;
  quickActionDisabled?: boolean;
}) {
  const isUser = message.role === "user";
  const isStreaming = message.client_status === "streaming" || message.client_status === "pending";
  const attachments = getAssistantMessageAttachments(message);
  const execution = getAssistantExecution(message);
  const showText = Boolean(message.content.trim());

  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}
    >
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        {showText ? (
          <View style={styles.textRow}>
            <Text style={[styles.text, isUser ? styles.userText : styles.assistantText]}>
              {message.content}
            </Text>
            {!isUser && isStreaming ? <View style={styles.streamingDot} /> : null}
          </View>
        ) : null}

        {!isUser ? (
          <AssistantExecutionBlock
            execution={execution}
            disabled={quickActionDisabled}
            onPressQuickAction={onPressQuickAction}
          />
        ) : null}

        {attachments.length ? <AttachmentList items={attachments} isUser={isUser} /> : null}

        <Text style={[styles.meta, isUser ? styles.userMeta : styles.assistantMeta]}>
          {isUser ? "我" : isStreaming ? "执行中" : "助手"} · {formatTime(message.created_at)}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    marginBottom: 18,
  },
  assistantContainer: {
    alignItems: "flex-start",
  },
  userContainer: {
    alignItems: "flex-end",
  },
  bubble: {
    maxWidth: "84%",
    gap: 8,
  },
  assistantBubble: {
    maxWidth: "100%",
  },
  userBubble: {
    backgroundColor: "#F1F3F7",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
  },
  text: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: fontFamily.body,
  },
  assistantText: {
    color: "#1F2837",
  },
  userText: {
    color: "#222B38",
  },
  meta: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  assistantMeta: {
    color: "#9AA6B8",
  },
  userMeta: {
    color: "#8E97A6",
  },
  streamingDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    marginTop: 1,
  },
  attachmentWrap: {
    gap: 8,
  },
  imageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  imageCard: {
    width: 108,
    height: 108,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#EEF3FA",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  fileList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  fileChip: {
    maxWidth: 220,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  assistantFileChip: {
    backgroundColor: "#F6F8FC",
  },
  userFileChip: {
    backgroundColor: "rgba(47,112,230,0.12)",
  },
  fileChipText: {
    flexShrink: 1,
    color: "#425166",
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  userFileChipText: {
    color: "#234A78",
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(8, 17, 34, 0.78)",
    paddingHorizontal: 16,
    paddingVertical: 32,
    justifyContent: "center",
  },
  previewCard: {
    borderRadius: radius.lg,
    backgroundColor: "#FFFFFF",
    padding: 14,
    gap: 12,
  },
  previewHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  previewTitle: {
    flex: 1,
    color: "#1F2837",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  previewClose: {
    borderRadius: radius.pill,
    backgroundColor: "#F2F5FA",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  previewCloseText: {
    color: "#5E6E82",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  previewImage: {
    width: "100%",
    height: 360,
    borderRadius: radius.md,
    backgroundColor: "#EEF3FA",
  },
  pressed: {
    opacity: 0.92,
  },
});
