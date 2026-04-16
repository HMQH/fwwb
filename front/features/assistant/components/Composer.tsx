import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { palette, radius } from "@/shared/theme";

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onPickAttachment: () => void;
  hasAttachment?: boolean;
  disabled?: boolean;
};

export default function Composer({
  value,
  onChange,
  onSend,
  onPickAttachment,
  hasAttachment = false,
  disabled = false,
}: ComposerProps) {
  const canSend = (value.trim().length > 0 || hasAttachment) && !disabled;

  return (
    <View style={styles.container}>
      <View style={styles.composerContainer}>
        <Pressable
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          disabled={disabled}
          onPress={onPickAttachment}
        >
          <MaterialCommunityIcons name="plus" size={22} color={palette.ink} />
        </Pressable>

        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder="发消息或上传附件"
          placeholderTextColor={palette.inkSoft}
          multiline
          maxLength={1200}
          editable={!disabled}
          onSubmitEditing={onSend}
          blurOnSubmit={false}
          returnKeyType="send"
        />

        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            canSend && styles.sendButtonActive,
            pressed && canSend && styles.pressed,
          ]}
          disabled={!canSend}
          onPress={onSend}
        >
          <MaterialCommunityIcons
            name="arrow-up"
            size={20}
            color={canSend ? palette.inkInverse : palette.inkSoft}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
  },
  composerContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    minHeight: 58,
    borderRadius: radius.pill,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: "#BFD3F4",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4F7FC",
  },
  input: {
    flex: 1,
    minHeight: 24,
    maxHeight: 100,
    paddingVertical: 8,
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "center",
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF3FA",
  },
  sendButtonActive: {
    backgroundColor: palette.accentStrong,
  },
  pressed: {
    opacity: 0.88,
  },
});
