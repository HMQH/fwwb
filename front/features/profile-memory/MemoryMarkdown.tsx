import { Fragment, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, radius } from "@/shared/theme";

type MarkdownBlock =
  | { type: "h1" | "h2" | "h3" | "quote" | "bullet" | "text"; text: string }
  | { type: "spacer" };

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    const text = paragraphBuffer.join(" ").trim();
    if (text) {
      blocks.push({ type: "text", text });
    }
    paragraphBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      if (blocks.length && blocks[blocks.length - 1]?.type !== "spacer") {
        blocks.push({ type: "spacer" });
      }
      continue;
    }

    if (line.startsWith("### ")) {
      flushParagraph();
      blocks.push({ type: "h3", text: line.slice(4).trim() });
      continue;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      blocks.push({ type: "h2", text: line.slice(3).trim() });
      continue;
    }

    if (line.startsWith("# ")) {
      flushParagraph();
      blocks.push({ type: "h1", text: line.slice(2).trim() });
      continue;
    }

    if (line.startsWith("> ")) {
      flushParagraph();
      blocks.push({ type: "quote", text: line.slice(2).trim() });
      continue;
    }

    if (line.startsWith("- ")) {
      flushParagraph();
      blocks.push({ type: "bullet", text: line.slice(2).trim() });
      continue;
    }

    paragraphBuffer.push(line);
  }

  flushParagraph();
  while (blocks.length && blocks[blocks.length - 1]?.type === "spacer") {
    blocks.pop();
  }
  return blocks;
}

function InlineMarkdownText({ text, style }: { text: string; style: object }) {
  const parts = text.split(/(`[^`]+`)/g).filter(Boolean);

  return (
    <Text style={style}>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <Text key={`${part}:${index}`} style={styles.inlineCode}>
              {part.slice(1, -1)}
            </Text>
          );
        }
        return <Fragment key={`${part}:${index}`}>{part}</Fragment>;
      })}
    </Text>
  );
}

export function MemoryMarkdown({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);

  if (!blocks.length) {
    return <Text style={styles.emptyText}>暂无</Text>;
  }

  return (
    <View style={styles.container}>
      {blocks.map((block, index) => {
        if (block.type === "spacer") {
          return <View key={`spacer:${index}`} style={styles.spacer} />;
        }

        if (block.type === "bullet") {
          return (
            <View key={`bullet:${index}`} style={styles.bulletRow}>
              <View style={styles.bulletDot} />
              <InlineMarkdownText text={block.text} style={styles.bulletText} />
            </View>
          );
        }

        if (block.type === "quote") {
          return (
            <View key={`quote:${index}`} style={styles.quoteCard}>
              <InlineMarkdownText text={block.text} style={styles.quoteText} />
            </View>
          );
        }

        if (block.type === "h1") {
          return <InlineMarkdownText key={`h1:${index}`} text={block.text} style={styles.h1} />;
        }

        if (block.type === "h2") {
          return <InlineMarkdownText key={`h2:${index}`} text={block.text} style={styles.h2} />;
        }

        if (block.type === "h3") {
          return <InlineMarkdownText key={`h3:${index}`} text={block.text} style={styles.h3} />;
        }

        return <InlineMarkdownText key={`text:${index}`} text={block.text} style={styles.text} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  spacer: {
    height: 4,
  },
  h1: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  h2: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
    marginTop: 6,
  },
  h3: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
    marginTop: 2,
  },
  text: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  quoteCard: {
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  quoteText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    marginTop: 7,
    backgroundColor: palette.accentStrong,
  },
  bulletText: {
    flex: 1,
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  inlineCode: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
    backgroundColor: palette.surfaceSoft,
  },
  emptyText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
});
