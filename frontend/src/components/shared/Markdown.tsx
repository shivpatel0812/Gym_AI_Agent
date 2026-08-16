import { useMemo } from "react";
import { View, Text, StyleSheet, TextStyle, StyleProp } from "react-native";
import { colors, spacing } from "../../theme";

/**
 * Minimal markdown renderer for AI coach and analysis output.
 *
 * Deliberately narrow: it covers the subset GPT actually emits in this app —
 * headings, bold/italic, inline code, bullet and numbered lists, and blank-line
 * paragraphs. Anything unrecognised falls through as plain text rather than
 * showing raw syntax, so a surprise construct degrades quietly.
 */

type InlineToken = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
// Ordered longest-delimiter first so *** isn't eaten by **, and ** isn't eaten
// by *. The italic branch requires non-space just inside the asterisks so
// arithmetic like "3 * 12 * 2" isn't rendered as emphasis.
// Underscore emphasis is deliberately unsupported: GPT uses asterisks, while
// _ appears inside identifiers like snake_case that must render verbatim.
const INLINE =
  /(\*\*\*[^*\n]+\*\*\*|\*\*[^*]+\*\*|\*[^\s*](?:[^*\n]*[^\s*])?\*|`[^`\n]+`)/g;

/** Split a line into styled runs. */
export function parseInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  // exec loop rather than matchAll: this runs on Hermes, and exec is safe on
  // every engine. INLINE is module-level and global, so reset it before use.
  INLINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE.exec(line)) !== null) {
    const index = match.index;
    if (index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, index) });
    }

    const raw = match[0];
    if (raw.startsWith("***")) {
      tokens.push({ text: raw.slice(3, -3), bold: true, italic: true });
    } else if (raw.startsWith("**")) {
      tokens.push({ text: raw.slice(2, -2), bold: true });
    } else if (raw.startsWith("`")) {
      tokens.push({ text: raw.slice(1, -1), code: true });
    } else {
      tokens.push({ text: raw.slice(1, -1), italic: true });
    }
    lastIndex = index + raw.length;
  }

  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex) });
  }
  return tokens.length > 0 ? tokens : [{ text: line }];
}

/** Strip markdown syntax for previews and other plain-text contexts. */
export function stripMarkdown(text: string): string {
  if (!text) return "";
  // Mirrors the INLINE rules above — keep the two in step
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^\s*](?:[^*\n]*[^\s*])?)\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function InlineText({ line, style }: { line: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={style}>
      {parseInline(line).map((token, i) => (
        <Text
          key={i}
          style={[
            token.bold && styles.bold,
            token.italic && styles.italic,
            token.code && styles.code,
          ]}
        >
          {token.text}
        </Text>
      ))}
    </Text>
  );
}

interface MarkdownProps {
  children: string;
  /** Base text style — colour and size are inherited by every block. */
  style?: StyleProp<TextStyle>;
}

export default function Markdown({ children, style }: MarkdownProps) {
  const lines = useMemo(() => (children || "").split("\n"), [children]);

  return (
    <View>
      {lines.map((line, i) => {
        const trimmed = line.trim();

        // Blank line — vertical gap between paragraphs
        if (!trimmed) {
          return <View key={i} style={styles.spacer} />;
        }

        const heading = trimmed.match(HEADING);
        if (heading) {
          const level = heading[1].length;
          return (
            <InlineText
              key={i}
              line={heading[2]}
              style={[
                styles.heading,
                level === 1 && styles.h1,
                level === 2 && styles.h2,
                level >= 3 && styles.h3,
              ]}
            />
          );
        }

        const bullet = trimmed.match(BULLET);
        if (bullet) {
          return (
            <View key={i} style={styles.listRow}>
              <Text style={[style, styles.bulletMark]}>•</Text>
              <InlineText line={bullet[1]} style={[style, styles.listText]} />
            </View>
          );
        }

        const numbered = trimmed.match(NUMBERED);
        if (numbered) {
          return (
            <View key={i} style={styles.listRow}>
              <Text style={[style, styles.numberMark]}>{numbered[1]}.</Text>
              <InlineText line={numbered[2]} style={[style, styles.listText]} />
            </View>
          );
        }

        return <InlineText key={i} line={trimmed} style={[style, styles.paragraph]} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  spacer: { height: spacing.sm },
  paragraph: { marginBottom: 2 },
  heading: {
    color: colors.textPrimary,
    fontWeight: "700",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  h1: { fontSize: 20 },
  h2: { fontSize: 17 },
  h3: { fontSize: 15 },
  bold: { fontWeight: "700", color: colors.textPrimary },
  italic: { fontStyle: "italic" },
  code: {
    fontFamily: "monospace",
    color: colors.ai,
  },
  listRow: {
    flexDirection: "row",
    marginBottom: spacing.xs,
    paddingRight: spacing.sm,
  },
  bulletMark: {
    width: 18,
    color: colors.accentPrimary,
  },
  numberMark: {
    minWidth: 22,
    color: colors.accentPrimary,
    fontWeight: "600",
  },
  listText: { flex: 1 },
});
